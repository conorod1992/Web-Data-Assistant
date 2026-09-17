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


def _response() -> FetchResponse:
    """Return a valid JSON response for lifecycle tests."""
    return FetchResponse(
        status=200,
        content_type="application/json",
        text='{"temperature":14.6}',
        json_data={"temperature": 14.6},
    )


async def test_delete_source_removes_entry_and_live_entity(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Delete a configured source through the real management WebSocket API."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Delete Me",
        data={
            CONF_SOURCE_NAME: "Delete Me",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/data.json",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_PATH: "/temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                }
            ],
        },
    )
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
