"""Real Home Assistant frontend/API smoke tests for Web Data Assistant."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
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
from custom_components.web_data_assistant.frontend import PANEL_URL_PATH
from custom_components.web_data_assistant.models import FetchResponse


async def test_panel_and_management_websocket_are_registered(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Expose the sidebar panel and source-management API after real HA setup."""
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
                }
            ],
        },
    )
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
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "get_panels"})
    panels = await client.receive_json()
    assert panels["success"] is True
    assert PANEL_URL_PATH in panels["result"]

    await client.send_json({"id": 2, "type": f"{DOMAIN}/list_sources"})
    sources_message = await client.receive_json()
    assert sources_message["success"] is True

    sources = sources_message["result"]["sources"]
    assert len(sources) == 1
    source = sources[0]
    assert source["entry_id"] == entry.entry_id
    assert source["title"] == "Weather API"
    assert source["source_type"] == SOURCE_JSON
    assert source["url"] == "https://example.test/weather.json"
    assert source["entity_count"] == 1
    assert source["source_available"] is True
    assert source["extraction_error_count"] == 0
