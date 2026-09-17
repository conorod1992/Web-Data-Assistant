"""Runtime coverage for aggregate JSON entities and long-text policies."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

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
    LONG_TEXT_TRUNCATE,
    LONG_TEXT_UNAVAILABLE,
    SOURCE_JSON,
    VALUE_NUMBER,
    VALUE_TEXT,
)
from custom_components.web_data_assistant.models import FetchResponse


def _response(data: dict) -> FetchResponse:
    return FetchResponse(
        status=200,
        content_type="application/json",
        text="{}",
        json_data=data,
    )


def _entity_id(hass: HomeAssistant, entry: MockConfigEntry, key: str) -> str:
    entity_id = er.async_get(hass).async_get_entity_id(
        "sensor", DOMAIN, f"{entry.entry_id}_{key}"
    )
    assert entity_id is not None
    return entity_id


async def test_json_sensor_combines_state_and_nested_attributes(
    hass: HomeAssistant,
) -> None:
    """Publish one selected state plus scalar and structured JSON attributes."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Weather",
        data={
            CONF_SOURCE_NAME: "Weather",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/weather.json",
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
        },
    )
    entry.add_to_hass(hass)
    payload = {
        "current": {"temperature": 14.6, "humidity": 82},
        "forecast": [
            {"day": "Friday", "condition": "Rain"},
            {"day": "Saturday", "condition": "Cloudy"},
        ],
    }

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response(payload)),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    state = hass.states.get(_entity_id(hass, entry, "weather"))
    assert state is not None
    assert state.state == "14.6"
    assert state.attributes["humidity"] == 82
    assert state.attributes["forecast"] == payload["forecast"]


async def test_json_attribute_container_uses_loaded_state(hass: HomeAssistant) -> None:
    """Allow a JSON entity to exist purely as an attribute container."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Weather document",
        data={
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
        },
    )
    entry.add_to_hass(hass)
    payload = {
        "current": {"temperature": 14.6, "condition": "Cloudy"},
        "alerts": ["wind", "rain"],
    }

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response(payload)),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    state = hass.states.get(_entity_id(hass, entry, "weather_document"))
    assert state is not None
    assert state.state == "Loaded"
    assert state.attributes["current"] == payload["current"]
    assert state.attributes["alerts"] == payload["alerts"]


async def test_long_text_policies_are_applied_per_entity(hass: HomeAssistant) -> None:
    """Support truncate, attribute-only and unavailable policies independently."""
    long_value = "x" * 320
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Long values",
        data={
            CONF_SOURCE_NAME: "Long values",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/long.json",
            CONF_LONG_TEXT_POLICY: LONG_TEXT_TRUNCATE,
            CONF_ENTITIES: [
                {
                    "key": "default_truncate",
                    "name": "Default truncate",
                    CONF_PATH: "/value",
                    CONF_VALUE_TYPE: VALUE_TEXT,
                },
                {
                    "key": "attribute_only",
                    "name": "Attribute only",
                    CONF_PATH: "/value",
                    CONF_VALUE_TYPE: VALUE_TEXT,
                    CONF_LONG_TEXT_POLICY: LONG_TEXT_ATTRIBUTE_ONLY,
                },
                {
                    "key": "unavailable",
                    "name": "Unavailable",
                    CONF_PATH: "/value",
                    CONF_VALUE_TYPE: VALUE_TEXT,
                    CONF_LONG_TEXT_POLICY: LONG_TEXT_UNAVAILABLE,
                },
            ],
        },
    )
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response({"value": long_value})),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    truncated = hass.states.get(_entity_id(hass, entry, "default_truncate"))
    attribute_only = hass.states.get(_entity_id(hass, entry, "attribute_only"))
    unavailable = hass.states.get(_entity_id(hass, entry, "unavailable"))

    assert truncated is not None
    assert len(truncated.state) == 255
    assert truncated.state.endswith("…")
    assert truncated.attributes["full_value"] == long_value
    assert truncated.attributes["state_truncated"] is True

    assert attribute_only is not None
    assert attribute_only.state == "Loaded"
    assert attribute_only.attributes["full_value"] == long_value
    assert attribute_only.attributes["state_truncated"] is False

    assert unavailable is not None
    assert unavailable.state == STATE_UNAVAILABLE
