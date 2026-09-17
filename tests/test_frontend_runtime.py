"""Real Home Assistant frontend/API smoke tests for Web Data Assistant."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_METHOD,
    CONF_PATH,
    CONF_SCAN_INTERVAL,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    CONF_VERIFY_SSL,
    DOMAIN,
    FAILURE_UNAVAILABLE,
    METHOD_GET,
    SOURCE_JSON,
    VALUE_NUMBER,
)
from custom_components.web_data_assistant.frontend import PANEL_URL_PATH
from custom_components.web_data_assistant.models import FetchResponse


def _response(value: float = 14.6) -> FetchResponse:
    """Return a valid JSON response for frontend/API smoke tests."""
    return FetchResponse(
        status=200,
        content_type="application/json",
        text=f'{{"current":{{"temperature":{value}}}}}',
        json_data={"current": {"temperature": value}},
    )


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

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response()),
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


async def test_panel_create_source_websocket_creates_working_entry(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Create a JSON source through the visual panel's real WebSocket save path."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    client = await hass_ws_client(hass)
    fetch = AsyncMock(return_value=_response())
    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/create_source",
                CONF_SOURCE_NAME: "Panel Weather",
                CONF_SOURCE_TYPE: SOURCE_JSON,
                CONF_URL: "https://example.test/weather.json",
                CONF_METHOD: METHOD_GET,
                CONF_VERIFY_SSL: True,
                CONF_SCAN_INTERVAL: 15,
                CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
                CONF_ENTITIES: [
                    {
                        "key": "temperature",
                        "name": "Temperature",
                        CONF_PATH: "/current/temperature",
                        CONF_VALUE_TYPE: VALUE_NUMBER,
                    }
                ],
            }
        )
        message = await client.receive_json()
        assert message["success"] is True
        entry_id = message["result"]["entry_id"]
        await hass.async_block_till_done()

    entry = hass.config_entries.async_get_entry(entry_id)
    assert entry is not None
    assert entry.title == "Panel Weather"
    assert entry.data[CONF_URL] == "https://example.test/weather.json"

    entity_id = er.async_get(hass).async_get_entity_id(
        "sensor",
        DOMAIN,
        f"{entry_id}_temperature",
    )
    assert entity_id is not None
    state = hass.states.get(entity_id)
    assert state is not None
    assert state.state == "14.6"
    assert fetch.await_count >= 2


async def test_management_refresh_updates_sensor_and_hides_url_secrets(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Refresh a source through the panel API without exposing URL secrets."""
    secret_url = "https://user:password@example.test/weather.json?token=secret#private"
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Private Weather",
        data={
            CONF_SOURCE_NAME: "Private Weather",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: secret_url,
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
    fetch = AsyncMock(return_value=_response(14.6))

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

        client = await hass_ws_client(hass)
        await client.send_json({"id": 1, "type": f"{DOMAIN}/list_sources"})
        list_message = await client.receive_json()
        assert list_message["success"] is True
        assert list_message["result"]["sources"][0]["url"] == (
            "https://example.test/weather.json"
        )

        fetch.return_value = _response(15.2)
        await client.send_json(
            {
                "id": 2,
                "type": f"{DOMAIN}/refresh_source",
                "entry_id": entry.entry_id,
            }
        )
        refresh_message = await client.receive_json()
        assert refresh_message["success"] is True
        assert refresh_message["result"]["source_available"] is True
        await hass.async_block_till_done()

    entity_id = er.async_get(hass).async_get_entity_id(
        "sensor", DOMAIN, f"{entry.entry_id}_temperature"
    )
    assert entity_id is not None
    state = hass.states.get(entity_id)
    assert state is not None
    assert state.state == "15.2"
    assert fetch.await_count == 2
