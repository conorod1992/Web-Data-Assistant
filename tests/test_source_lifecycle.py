"""Real Home Assistant source lifecycle tests for Web Data Assistant."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_PATH,
    CONF_SCAN_INTERVAL,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    DOMAIN,
    FAILURE_UNAVAILABLE,
    SOURCE_JSON,
    VALUE_NUMBER,
)
from custom_components.web_data_assistant.models import FetchResponse


def _response(*, temperature: float = 14.6, humidity: int = 82) -> FetchResponse:
    """Return a valid JSON response for lifecycle tests."""
    text = f'{{"temperature":{temperature},"humidity":{humidity}}}'
    return FetchResponse(
        status=200,
        content_type="application/json",
        text=text,
        json_data={"temperature": temperature, "humidity": humidity},
    )


def _entry(*, url: str = "https://example.test/data.json") -> MockConfigEntry:
    """Build a two-sensor config entry for lifecycle tests."""
    return MockConfigEntry(
        domain=DOMAIN,
        title="Weather",
        data={
            CONF_SOURCE_NAME: "Weather",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: url,
            CONF_SCAN_INTERVAL: 5,
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_PATH: "/temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                },
                {
                    "key": "humidity",
                    "name": "Humidity",
                    CONF_PATH: "/humidity",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                },
            ],
        },
    )


async def test_delete_source_removes_entry_and_live_entity(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Delete a configured source through the real management WebSocket API."""
    entry = _entry()
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response()),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    entity_id = er.async_get(hass).async_get_entity_id(
        "sensor", DOMAIN, f"{entry.entry_id}_temperature"
    )
    assert entity_id is not None
    assert hass.states.get(entity_id) is not None

    client = await hass_ws_client(hass)
    await client.send_json(
        {
            "id": 1,
            "type": f"{DOMAIN}/delete_source",
            "entry_id": entry.entry_id,
        }
    )
    message = await client.receive_json()
    await hass.async_block_till_done()

    assert message["success"] is True
    assert message["result"]["entry_id"] == entry.entry_id
    assert hass.config_entries.async_get_entry(entry.entry_id) is None
    assert hass.states.get(entity_id) is None


async def test_get_source_returns_full_config_only_on_explicit_admin_request(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Keep dashboard metadata redacted while allowing an admin to open Edit."""
    secret_url = "https://user:password@example.test/data.json?token=secret#private"
    entry = _entry(url=secret_url)
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response()),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/list_sources"})
    list_message = await client.receive_json()
    assert list_message["success"] is True
    assert list_message["result"]["sources"][0]["url"] == (
        "https://example.test/data.json"
    )

    await client.send_json(
        {"id": 2, "type": f"{DOMAIN}/get_source", "entry_id": entry.entry_id}
    )
    edit_message = await client.receive_json()
    assert edit_message["success"] is True
    editable = edit_message["result"]
    assert editable["entry_id"] == entry.entry_id
    assert editable["url"] == secret_url
    assert editable["source_name"] == "Weather"
    assert [entity["key"] for entity in editable["entities"]] == [
        "temperature",
        "humidity",
    ]


async def test_update_source_preserves_stable_entity_and_removes_deleted_key(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Edit in place without changing stable entity identity or leaving ghost entities."""
    entry = _entry()
    entry.add_to_hass(hass)
    fetch = AsyncMock(return_value=_response())

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

        registry = er.async_get(hass)
        temperature_entity_id = registry.async_get_entity_id(
            "sensor", DOMAIN, f"{entry.entry_id}_temperature"
        )
        humidity_entity_id = registry.async_get_entity_id(
            "sensor", DOMAIN, f"{entry.entry_id}_humidity"
        )
        assert temperature_entity_id is not None
        assert humidity_entity_id is not None

        client = await hass_ws_client(hass)
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/update_source",
                "entry_id": entry.entry_id,
                CONF_SOURCE_NAME: "Renamed Weather",
                CONF_SOURCE_TYPE: SOURCE_JSON,
                CONF_URL: "https://example.test/data.json",
                CONF_SCAN_INTERVAL: 15,
                CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
                CONF_ENTITIES: [
                    {
                        "key": "temperature",
                        "name": "Outside Temperature",
                        CONF_PATH: "/temperature",
                        CONF_VALUE_TYPE: VALUE_NUMBER,
                    }
                ],
            }
        )
        message = await client.receive_json()
        await hass.async_block_till_done()

    assert message["success"] is True
    updated_entry = hass.config_entries.async_get_entry(entry.entry_id)
    assert updated_entry is not None
    assert updated_entry.entry_id == entry.entry_id
    assert updated_entry.title == "Renamed Weather"
    assert updated_entry.data[CONF_SCAN_INTERVAL] == 15
    assert [entity["key"] for entity in updated_entry.data[CONF_ENTITIES]] == [
        "temperature"
    ]

    registry = er.async_get(hass)
    assert (
        registry.async_get_entity_id(
            "sensor", DOMAIN, f"{entry.entry_id}_temperature"
        )
        == temperature_entity_id
    )
    assert (
        registry.async_get_entity_id("sensor", DOMAIN, f"{entry.entry_id}_humidity")
        is None
    )
    state = hass.states.get(temperature_entity_id)
    assert state is not None
    assert state.state == "14.6"
