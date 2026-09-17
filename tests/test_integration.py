"""Real Home Assistant smoke tests for Web Data Assistant."""

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


def _json_entry() -> MockConfigEntry:
    """Return a simple JSON-backed config entry."""
    return MockConfigEntry(
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
                }
            ],
        },
    )


async def test_json_entry_sets_up_real_sensor(hass: HomeAssistant) -> None:
    """Set up a config entry through HA and publish an extracted sensor state."""
    entry = _json_entry()
    entry.add_to_hass(hass)

    response = FetchResponse(
        status=200,
        content_type="application/json",
        text='{"current":{"temperature":14.6}}',
        json_data={"current": {"temperature": 14.6}},
    )

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ) as fetch:
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    fetch.assert_awaited_once()

    entity_registry = er.async_get(hass)
    entity_id = entity_registry.async_get_entity_id(
        "sensor",
        DOMAIN,
        f"{entry.entry_id}_temperature",
    )
    assert entity_id is not None

    state = hass.states.get(entity_id)
    assert state is not None
    assert state.state == "14.6"
    assert state.attributes["source_available"] is True
    assert "last_successful_update" in state.attributes
