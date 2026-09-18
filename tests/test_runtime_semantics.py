"""Real Home Assistant runtime semantics tests for Web Data Assistant."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_PATH,
    CONF_SELECTOR,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    DOMAIN,
    FAILURE_KEEP_LAST,
    FAILURE_UNAVAILABLE,
    SOURCE_JSON,
    SOURCE_SCRAPE,
    VALUE_NUMBER,
    VALUE_TEXT,
)
from custom_components.web_data_assistant.extraction import extract_html_entities
from custom_components.web_data_assistant.models import FetchResponse


def _response(data: dict) -> FetchResponse:
    """Return a successful JSON response."""
    return FetchResponse(
        status=200,
        content_type="application/json",
        text="{}",
        json_data=data,
    )


async def test_extraction_failure_is_not_source_failure_and_recovers(
    hass: HomeAssistant,
) -> None:
    """Keep source health successful when only a selected JSON path is missing."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Weather API",
        data={
            CONF_SOURCE_NAME: "Weather API",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/weather.json",
            CONF_FAILURE_MODE: FAILURE_KEEP_LAST,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_PATH: "/current/temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                }
            ],
        },
    )
    entry.add_to_hass(hass)
    fetch = AsyncMock(return_value=_response({"current": {"condition": "Cloudy"}}))

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

        entity_id = er.async_get(hass).async_get_entity_id(
            "sensor", DOMAIN, f"{entry.entry_id}_temperature"
        )
        assert entity_id is not None
        state = hass.states.get(entity_id)
        assert state is not None
        assert state.state == STATE_UNAVAILABLE
        assert entry.runtime_data.last_update_success is True
        assert entry.runtime_data.last_source_error is None
        assert entry.runtime_data.extraction_error_for("temperature") is not None

        fetch.return_value = _response({"current": {"temperature": 15.2}})
        await entry.runtime_data.async_request_refresh()
        await hass.async_block_till_done()

    recovered = hass.states.get(entity_id)
    assert recovered is not None
    assert recovered.state == "15.2"
    assert recovered.attributes["source_available"] is True
    assert entry.runtime_data.extraction_error_for("temperature") is None


async def test_multiple_json_sensors_share_fetch_and_service_device(
    hass: HomeAssistant,
) -> None:
    """Use one coordinator request and one HA service device for one source."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Weather API",
        data={
            CONF_SOURCE_NAME: "Weather API",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/weather.json",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_PATH: "/current/temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                },
                {
                    "key": "humidity",
                    "name": "Humidity",
                    CONF_PATH: "/current/humidity",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                },
            ],
        },
    )
    entry.add_to_hass(hass)
    fetch = AsyncMock(
        return_value=_response({"current": {"temperature": 14.6, "humidity": 82}})
    )

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    fetch.assert_awaited_once()

    entity_registry = er.async_get(hass)
    temperature_id = entity_registry.async_get_entity_id(
        "sensor", DOMAIN, f"{entry.entry_id}_temperature"
    )
    humidity_id = entity_registry.async_get_entity_id(
        "sensor", DOMAIN, f"{entry.entry_id}_humidity"
    )
    assert temperature_id is not None
    assert humidity_id is not None
    temperature_state = hass.states.get(temperature_id)
    humidity_state = hass.states.get(humidity_id)
    assert temperature_state is not None
    assert humidity_state is not None
    assert temperature_state.state == "14.6"
    assert humidity_state.state == "82"

    temperature_entry = entity_registry.async_get(temperature_id)
    humidity_entry = entity_registry.async_get(humidity_id)
    assert temperature_entry is not None
    assert humidity_entry is not None
    assert temperature_entry.device_id is not None
    assert temperature_entry.device_id == humidity_entry.device_id

    device = dr.async_get(hass).async_get(temperature_entry.device_id)
    assert device is not None
    assert device.entry_type is dr.DeviceEntryType.SERVICE
    assert device.name == "Weather API"
    assert (DOMAIN, entry.entry_id) in device.identifiers



async def test_multiple_scrape_sensors_share_fetch_and_html_parse(
    hass: HomeAssistant,
) -> None:
    """Fetch and parse one page once while updating multiple scrape sensors."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Weather Page",
        data={
            CONF_SOURCE_NAME: "Weather Page",
            CONF_SOURCE_TYPE: SOURCE_SCRAPE,
            CONF_URL: "https://example.test/weather",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_SELECTOR: ".temperature",
                    CONF_VALUE_TYPE: VALUE_TEXT,
                },
                {
                    "key": "humidity",
                    "name": "Humidity",
                    CONF_SELECTOR: ".humidity",
                    CONF_VALUE_TYPE: VALUE_TEXT,
                },
            ],
        },
    )
    entry.add_to_hass(hass)
    response = FetchResponse(
        status=200,
        content_type="text/html",
        text=(
            '<html><body><span class="temperature">14°C</span>'
            '<span class="humidity">82%</span></body></html>'
        ),
        json_data=None,
    )
    fetch = AsyncMock(return_value=response)

    with (
        patch(
            "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
            new=fetch,
        ),
        patch(
            "custom_components.web_data_assistant.coordinator.extract_html_entities",
            wraps=extract_html_entities,
        ) as extract_all,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    fetch.assert_awaited_once()
    assert extract_all.call_count == 1

    entity_registry = er.async_get(hass)
    temperature_id = entity_registry.async_get_entity_id(
        "sensor", DOMAIN, f"{entry.entry_id}_temperature"
    )
    humidity_id = entity_registry.async_get_entity_id(
        "sensor", DOMAIN, f"{entry.entry_id}_humidity"
    )
    assert temperature_id is not None
    assert humidity_id is not None
    assert hass.states[temperature_id].state == "14°C"
    assert hass.states[humidity_id].state == "82%"



async def test_multi_scrape_extraction_failure_is_isolated(
    hass: HomeAssistant,
) -> None:
    """Keep valid scrape sensors available when one selector stops matching."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Weather Page",
        data={
            CONF_SOURCE_NAME: "Weather Page",
            CONF_SOURCE_TYPE: SOURCE_SCRAPE,
            CONF_URL: "https://example.test/weather",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_SELECTOR: ".temperature",
                    CONF_VALUE_TYPE: VALUE_TEXT,
                },
                {
                    "key": "humidity",
                    "name": "Humidity",
                    CONF_SELECTOR: ".humidity",
                    CONF_VALUE_TYPE: VALUE_TEXT,
                },
            ],
        },
    )
    entry.add_to_hass(hass)
    response = FetchResponse(
        status=200,
        content_type="text/html",
        text='<html><body><span class="temperature">14°C</span></body></html>',
        json_data=None,
    )

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    registry = er.async_get(hass)
    temperature_id = registry.async_get_entity_id(
        "sensor", DOMAIN, f"{entry.entry_id}_temperature"
    )
    humidity_id = registry.async_get_entity_id(
        "sensor", DOMAIN, f"{entry.entry_id}_humidity"
    )
    assert temperature_id is not None
    assert humidity_id is not None
    assert hass.states[temperature_id].state == "14°C"
    assert hass.states[humidity_id].state == STATE_UNAVAILABLE
    assert entry.runtime_data.last_update_success is True
    assert entry.runtime_data.extraction_error_for("temperature") is None
    assert entry.runtime_data.extraction_error_for("humidity") is not None
