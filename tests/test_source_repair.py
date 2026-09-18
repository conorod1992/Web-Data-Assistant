"""Real Home Assistant guided extraction repair tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.web_data_assistant.const import (
    CONF_ATTRIBUTES,
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_INDEX,
    CONF_PATH,
    CONF_SELECTOR,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    DOMAIN,
    FAILURE_UNAVAILABLE,
    SOURCE_JSON,
    SOURCE_SCRAPE,
    VALUE_NUMBER,
    VALUE_TEXT,
)
from custom_components.web_data_assistant.models import FetchResponse


def _response(data: dict) -> FetchResponse:
    """Return a successful JSON response."""
    return FetchResponse(
        status=200,
        content_type="application/json",
        text="{}",
        json_data=data,
    )


async def test_list_sources_reports_repairable_extraction_issue_without_secrets(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Expose a safe per-entity repair issue without leaking request secrets."""
    secret_url = "https://user:password@example.test/weather?token=secret#private"
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Weather",
        data={
            CONF_SOURCE_NAME: "Weather",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: secret_url,
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "humidity",
                    "name": "Humidity",
                    CONF_PATH: "/current/humidity",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                }
            ],
        },
    )
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response({"current": {}})),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/list_sources"})
    message = await client.receive_json()

    assert message["success"] is True
    source = message["result"]["sources"][0]
    assert source["url"] == "https://example.test/weather"
    assert source["extraction_error_count"] == 1
    assert source["extraction_issues"] == [
        {
            "key": "humidity",
            "name": "Humidity",
            "error": source["extraction_issues"][0]["error"],
            "repairable": True,
        }
    ]
    payload_text = str(source)
    assert "password" not in payload_text
    assert "token=secret" not in payload_text
    assert "private" not in payload_text


async def test_repair_json_entity_updates_only_selected_path_and_preserves_identity(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Repair one broken JSON sensor without requiring broken siblings to validate."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Weather",
        data={
            CONF_SOURCE_NAME: "Weather",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/weather.json",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_PATH: "/old/temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                },
                {
                    "key": "humidity",
                    "name": "Humidity",
                    CONF_PATH: "/old/humidity",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                },
            ],
        },
    )
    entry.add_to_hass(hass)
    fetch = AsyncMock(return_value=_response({"current": {"temperature": 14.6}}))

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
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

        client = await hass_ws_client(hass)
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/repair_entity",
                "entry_id": entry.entry_id,
                "entity_key": "temperature",
                CONF_PATH: "/current/temperature",
            }
        )
        message = await client.receive_json()
        await hass.async_block_till_done()

    assert message["success"] is True
    assert message["result"]["entity_key"] == "temperature"

    updated = hass.config_entries.async_get_entry(entry.entry_id)
    assert updated is not None
    entities = {entity["key"]: entity for entity in updated.data[CONF_ENTITIES]}
    assert entities["temperature"][CONF_PATH] == "/current/temperature"
    assert entities["humidity"][CONF_PATH] == "/old/humidity"

    registry = er.async_get(hass)
    assert (
        registry.async_get_entity_id(
            "sensor", DOMAIN, f"{entry.entry_id}_temperature"
        )
        == temperature_id
    )
    assert (
        registry.async_get_entity_id(
            "sensor", DOMAIN, f"{entry.entry_id}_humidity"
        )
        == humidity_id
    )

    temperature_state = hass.states.get(temperature_id)
    humidity_state = hass.states.get(humidity_id)
    assert temperature_state is not None
    assert temperature_state.state == "14.6"
    assert humidity_state is not None
    assert humidity_state.state == "unavailable"


async def test_repair_scrape_entity_replaces_selector_and_preserves_identity(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Repair a broken scrape selector without recreating the Home Assistant entity."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Status Page",
        data={
            CONF_SOURCE_NAME: "Status Page",
            CONF_SOURCE_TYPE: SOURCE_SCRAPE,
            CONF_URL: "https://example.test/status",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "service_status",
                    "name": "Service Status",
                    CONF_SELECTOR: ".old-status",
                    CONF_INDEX: 0,
                    CONF_VALUE_TYPE: VALUE_TEXT,
                }
            ],
        },
    )
    entry.add_to_hass(hass)
    fetch = AsyncMock(
        return_value=FetchResponse(
            status=200,
            content_type="text/html",
            text='<html><body><span class="new-status">Online</span></body></html>',
            json_data=None,
        )
    )

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

        registry = er.async_get(hass)
        entity_id = registry.async_get_entity_id(
            "sensor", DOMAIN, f"{entry.entry_id}_service_status"
        )
        assert entity_id is not None

        client = await hass_ws_client(hass)
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/repair_entity",
                "entry_id": entry.entry_id,
                "entity_key": "service_status",
                CONF_SELECTOR: ".new-status",
                CONF_INDEX: 0,
            }
        )
        message = await client.receive_json()
        await hass.async_block_till_done()

    assert message["success"] is True
    updated = hass.config_entries.async_get_entry(entry.entry_id)
    assert updated is not None
    entity = updated.data[CONF_ENTITIES][0]
    assert entity[CONF_SELECTOR] == ".new-status"
    assert entity[CONF_INDEX] == 0

    registry = er.async_get(hass)
    assert (
        registry.async_get_entity_id(
            "sensor", DOMAIN, f"{entry.entry_id}_service_status"
        )
        == entity_id
    )
    state = hass.states.get(entity_id)
    assert state is not None
    assert state.state == "Online"


async def test_complex_json_entity_is_reported_but_not_directly_repairable(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Require full Edit when one JSON sensor contains multiple extraction paths."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Weather",
        data={
            CONF_SOURCE_NAME: "Weather",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/weather.json",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "weather",
                    "name": "Weather",
                    CONF_PATH: "/current/temperature",
                    CONF_ATTRIBUTES: {"humidity": "/current/humidity"},
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                }
            ],
        },
    )
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response({"current": {"temperature": 14.6}})),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/list_sources"})
    listed = await client.receive_json()
    issue = listed["result"]["sources"][0]["extraction_issues"][0]
    assert issue["name"] == "Weather"
    assert issue["repairable"] is False

    await client.send_json(
        {
            "id": 2,
            "type": f"{DOMAIN}/repair_entity",
            "entry_id": entry.entry_id,
            "entity_key": "weather",
            CONF_PATH: "/current/temperature",
        }
    )
    repair = await client.receive_json()
    assert repair["success"] is False
    assert repair["error"]["code"] == "not_repairable"
