"""Real Home Assistant WebSocket validation tests for Web Data Assistant."""

from __future__ import annotations

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant

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


async def test_create_source_rejects_duplicate_entity_keys(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Reject duplicate keys before validation fetch or config-entry creation."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    client = await hass_ws_client(hass)
    await client.send_json(
        {
            "id": 1,
            "type": f"{DOMAIN}/create_source",
            CONF_SOURCE_NAME: "Duplicate Keys",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/data.json",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_PATH: "/temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                },
                {
                    "key": "temperature",
                    "name": "Temperature Copy",
                    CONF_PATH: "/temperature_copy",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                },
            ],
        }
    )
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "invalid_entities"
    assert "unique key" in message["error"]["message"]
    assert hass.config_entries.async_entries(DOMAIN) == []
