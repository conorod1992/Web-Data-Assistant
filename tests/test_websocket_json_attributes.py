"""WebSocket creation coverage for aggregate JSON output modes."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant

from custom_components.web_data_assistant.const import (
    CONF_ATTRIBUTES,
    CONF_ENTITIES,
    CONF_LONG_TEXT_POLICY,
    CONF_PATH,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    DOMAIN,
    LONG_TEXT_ATTRIBUTE_ONLY,
    SOURCE_JSON,
    VALUE_NUMBER,
    VALUE_TEXT,
)
from custom_components.web_data_assistant.models import FetchResponse


async def _register_commands(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert result["step_id"] == "user"


async def test_create_source_accepts_state_and_json_attributes(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Validate and persist a JSON sensor with one state and selected attributes."""
    await _register_commands(hass)
    response = FetchResponse(
        status=200,
        content_type="application/json",
        text="{}",
        json_data={
            "current": {"temperature": 14.6, "humidity": 82},
            "forecast": [{"day": "Friday", "condition": "Rain"}],
        },
    )
    client = await hass_ws_client(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ):
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/create_source",
                CONF_SOURCE_NAME: "Weather",
                CONF_SOURCE_TYPE: SOURCE_JSON,
                CONF_URL: "https://example.test/weather.json",
                CONF_LONG_TEXT_POLICY: LONG_TEXT_ATTRIBUTE_ONLY,
                CONF_ENTITIES: [
                    {
                        "key": "weather",
                        "name": "Weather",
                        CONF_PATH: "/current/temperature",
                        CONF_VALUE_TYPE: VALUE_NUMBER,
                        CONF_ATTRIBUTES: {
                            "humidity": "/current/humidity",
                            "forecast": "/forecast",
                        },
                    }
                ],
            }
        )
        message = await client.receive_json()

    assert message["success"] is True
    entries = hass.config_entries.async_entries(DOMAIN)
    assert len(entries) == 1
    assert entries[0].data[CONF_LONG_TEXT_POLICY] == LONG_TEXT_ATTRIBUTE_ONLY
    assert entries[0].data[CONF_ENTITIES][0][CONF_ATTRIBUTES] == {
        "humidity": "/current/humidity",
        "forecast": "/forecast",
    }


async def test_create_source_accepts_attribute_only_json_entity(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Allow a JSON entity with no state path when it has selected attributes."""
    await _register_commands(hass)
    response = FetchResponse(
        status=200,
        content_type="application/json",
        text="{}",
        json_data={"current": {"temperature": 14.6}, "alerts": ["wind"]},
    )
    client = await hass_ws_client(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ):
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/create_source",
                CONF_SOURCE_NAME: "Weather document",
                CONF_SOURCE_TYPE: SOURCE_JSON,
                CONF_URL: "https://example.test/weather.json",
                CONF_ENTITIES: [
                    {
                        "key": "weather_document",
                        "name": "Weather document",
                        CONF_VALUE_TYPE: VALUE_TEXT,
                        CONF_ATTRIBUTES: {
                            "current": "/current",
                            "alerts": "/alerts",
                        },
                    }
                ],
            }
        )
        message = await client.receive_json()

    assert message["success"] is True
    entity = hass.config_entries.async_entries(DOMAIN)[0].data[CONF_ENTITIES][0]
    assert CONF_PATH not in entity
    assert entity[CONF_ATTRIBUTES] == {
        "current": "/current",
        "alerts": "/alerts",
    }


async def test_create_source_rejects_missing_json_attribute_path(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Validate every selected JSON attribute path against the fetched sample."""
    await _register_commands(hass)
    response = FetchResponse(
        status=200,
        content_type="application/json",
        text="{}",
        json_data={"current": {"temperature": 14.6}},
    )
    client = await hass_ws_client(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ):
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/create_source",
                CONF_SOURCE_NAME: "Broken attributes",
                CONF_SOURCE_TYPE: SOURCE_JSON,
                CONF_URL: "https://example.test/weather.json",
                CONF_ENTITIES: [
                    {
                        "key": "weather",
                        "name": "Weather",
                        CONF_VALUE_TYPE: VALUE_TEXT,
                        CONF_ATTRIBUTES: {"humidity": "/current/humidity"},
                    }
                ],
            }
        )
        message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "validation_failed"
    assert hass.config_entries.async_entries(DOMAIN) == []
