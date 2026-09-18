"""Runtime coverage for native Home Assistant sensor metadata."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.web_data_assistant.const import (
    CONF_DEVICE_CLASS,
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_PATH,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_STATE_CLASS,
    CONF_UNIT,
    CONF_URL,
    CONF_VALUE_TYPE,
    DOMAIN,
    FAILURE_UNAVAILABLE,
    SOURCE_JSON,
    VALUE_NUMBER,
)
from custom_components.web_data_assistant.models import FetchResponse


async def test_native_sensor_metadata_is_exposed_by_home_assistant(
    hass: HomeAssistant,
) -> None:
    """Apply stored device/state classes and unit to the live HA sensor."""
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
                    CONF_PATH: "/temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                    CONF_UNIT: "°C",
                    CONF_DEVICE_CLASS: "temperature",
                    CONF_STATE_CLASS: "measurement",
                }
            ],
        },
    )
    entry.add_to_hass(hass)
    response = FetchResponse(
        status=200,
        content_type="application/json",
        text='{"temperature":14.6}',
        json_data={"temperature": 14.6},
    )

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    entity_id = er.async_get(hass).async_get_entity_id(
        "sensor", DOMAIN, f"{entry.entry_id}_temperature"
    )
    assert entity_id is not None

    state = hass.states.get(entity_id)
    assert state is not None
    assert state.state == "14.6"
    assert state.attributes["device_class"] == "temperature"
    assert state.attributes["state_class"] == "measurement"
    assert state.attributes["unit_of_measurement"] == "°C"
