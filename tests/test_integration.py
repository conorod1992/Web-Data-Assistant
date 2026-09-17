"""Real Home Assistant smoke tests for Web Data Assistant."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.web_data_assistant.client import WebDataConnectionError
from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_PATH,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    DOMAIN,
    FAILURE_KEEP_LAST,
    FAILURE_UNAVAILABLE,
    SOURCE_JSON,
    VALUE_NUMBER,
)
from custom_components.web_data_assistant.models import FetchResponse


def _json_entry(failure_mode: str = FAILURE_UNAVAILABLE) -> MockConfigEntry:
    """Return a simple JSON-backed config entry."""
    return MockConfigEntry(
        domain=DOMAIN,
        title="Weather API",
        data={
            CONF_SOURCE_NAME: "Weather API",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/weather.json",
            CONF_FAILURE_MODE: failure_mode,
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


def _response(value: float = 14.6) -> FetchResponse:
    """Return a successful JSON response containing a temperature."""
    return FetchResponse(
        status=200,
        content_type="application/json",
        text=f'{{"current":{{"temperature":{value}}}}}',
        json_data={"current": {"temperature": value}},
    )


def _entity_id(hass: HomeAssistant, entry: MockConfigEntry) -> str:
    """Return the registered temperature entity id for an entry."""
    entity_id = er.async_get(hass).async_get_entity_id(
        "sensor",
        DOMAIN,
        f"{entry.entry_id}_temperature",
    )
    assert entity_id is not None
    return entity_id


async def test_json_entry_sets_up_real_sensor(hass: HomeAssistant) -> None:
    """Set up a config entry through HA and publish an extracted sensor state."""
    entry = _json_entry()
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response()),
    ) as fetch:
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    fetch.assert_awaited_once()

    state = hass.states.get(_entity_id(hass, entry))
    assert state is not None
    assert state.state == "14.6"
    assert state.attributes["source_available"] is True
    assert "last_successful_update" in state.attributes


async def test_unreachable_source_loads_unavailable_sensor(hass: HomeAssistant) -> None:
    """Keep the entry loaded and expose an unavailable sensor after startup failure."""
    entry = _json_entry(FAILURE_UNAVAILABLE)
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(side_effect=WebDataConnectionError("The request timed out")),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    state = hass.states.get(_entity_id(hass, entry))
    assert state is not None
    assert state.state == STATE_UNAVAILABLE


async def test_keep_last_survives_runtime_source_outage(hass: HomeAssistant) -> None:
    """Retain the last successful state when a later source refresh fails."""
    entry = _json_entry(FAILURE_KEEP_LAST)
    entry.add_to_hass(hass)
    fetch = AsyncMock(return_value=_response())

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

        entity_id = _entity_id(hass, entry)
        initial = hass.states.get(entity_id)
        assert initial is not None
        assert initial.state == "14.6"
        last_success = initial.attributes["last_successful_update"]

        fetch.side_effect = WebDataConnectionError("The request timed out")
        await entry.runtime_data.async_request_refresh()
        await hass.async_block_till_done()

    state = hass.states.get(entity_id)
    assert state is not None
    assert state.state == "14.6"
    assert state.attributes["source_available"] is False
    assert state.attributes["last_successful_update"] == last_success
    assert state.attributes["source_error"] == "The request timed out"
