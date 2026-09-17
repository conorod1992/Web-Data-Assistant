"""Schema-boundary tests for Web Data Assistant WebSocket commands."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant

from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_MAX_STALE_MINUTES,
    CONF_METHOD,
    CONF_PATH,
    CONF_SCAN_INTERVAL,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    DOMAIN,
    FAILURE_KEEP_LAST,
    FAILURE_UNAVAILABLE,
    SOURCE_JSON,
    VALUE_NUMBER,
)


async def test_preview_json_rejects_non_http_url(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Reject non-HTTP(S) URLs before any preview fetch occurs."""
    flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert flow["step_id"] == "user"
    fetch = AsyncMock()
    client = await hass_ws_client(hass)
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=fetch):
        await client.send_json({"id": 1, "type": f"{DOMAIN}/preview_json", "url": "ftp://example.test/data.json"})
        message = await client.receive_json()
    assert message["success"] is False
    assert message["error"]["code"] == "invalid_format"
    fetch.assert_not_awaited()
    assert hass.config_entries.async_entries(DOMAIN) == []


async def test_create_source_rejects_scan_interval_below_minimum(hass: HomeAssistant, hass_ws_client) -> None:
    flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert flow["step_id"] == "user"
    fetch = AsyncMock()
    client = await hass_ws_client(hass)
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=fetch):
        await client.send_json({"id":1,"type":f"{DOMAIN}/create_source",CONF_SOURCE_NAME:"Too Fast",CONF_SOURCE_TYPE:SOURCE_JSON,CONF_URL:"https://example.test/data.json",CONF_SCAN_INTERVAL:0,CONF_FAILURE_MODE:FAILURE_UNAVAILABLE,CONF_ENTITIES:[{"key":"temperature","name":"Temperature",CONF_PATH:"/temperature",CONF_VALUE_TYPE:VALUE_NUMBER}]})
        message = await client.receive_json()
    assert message["success"] is False
    assert message["error"]["code"] == "invalid_format"
    fetch.assert_not_awaited()
    assert hass.config_entries.async_entries(DOMAIN) == []


async def test_create_source_rejects_scan_interval_above_maximum(hass: HomeAssistant, hass_ws_client) -> None:
    flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert flow["step_id"] == "user"
    fetch = AsyncMock()
    client = await hass_ws_client(hass)
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=fetch):
        await client.send_json({"id":1,"type":f"{DOMAIN}/create_source",CONF_SOURCE_NAME:"Too Slow",CONF_SOURCE_TYPE:SOURCE_JSON,CONF_URL:"https://example.test/data.json",CONF_SCAN_INTERVAL:1441,CONF_FAILURE_MODE:FAILURE_UNAVAILABLE,CONF_ENTITIES:[{"key":"temperature","name":"Temperature",CONF_PATH:"/temperature",CONF_VALUE_TYPE:VALUE_NUMBER}]})
        message = await client.receive_json()
    assert message["success"] is False
    assert message["error"]["code"] == "invalid_format"
    fetch.assert_not_awaited()
    assert hass.config_entries.async_entries(DOMAIN) == []


async def test_create_source_rejects_zero_stale_timeout(hass: HomeAssistant, hass_ws_client) -> None:
    flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert flow["step_id"] == "user"
    fetch = AsyncMock()
    client = await hass_ws_client(hass)
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=fetch):
        await client.send_json({"id":1,"type":f"{DOMAIN}/create_source",CONF_SOURCE_NAME:"Bad Stale Timeout",CONF_SOURCE_TYPE:SOURCE_JSON,CONF_URL:"https://example.test/data.json",CONF_FAILURE_MODE:FAILURE_KEEP_LAST,CONF_MAX_STALE_MINUTES:0,CONF_ENTITIES:[{"key":"temperature","name":"Temperature",CONF_PATH:"/temperature",CONF_VALUE_TYPE:VALUE_NUMBER}]})
        message = await client.receive_json()
    assert message["success"] is False
    assert message["error"]["code"] == "invalid_format"
    fetch.assert_not_awaited()
    assert hass.config_entries.async_entries(DOMAIN) == []


async def test_create_source_rejects_stale_timeout_above_maximum(hass: HomeAssistant, hass_ws_client) -> None:
    flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert flow["step_id"] == "user"
    fetch = AsyncMock()
    client = await hass_ws_client(hass)
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=fetch):
        await client.send_json({"id":1,"type":f"{DOMAIN}/create_source",CONF_SOURCE_NAME:"Excessive Stale Timeout",CONF_SOURCE_TYPE:SOURCE_JSON,CONF_URL:"https://example.test/data.json",CONF_FAILURE_MODE:FAILURE_KEEP_LAST,CONF_MAX_STALE_MINUTES:525601,CONF_ENTITIES:[{"key":"temperature","name":"Temperature",CONF_PATH:"/temperature",CONF_VALUE_TYPE:VALUE_NUMBER}]})
        message = await client.receive_json()
    assert message["success"] is False
    assert message["error"]["code"] == "invalid_format"
    fetch.assert_not_awaited()
    assert hass.config_entries.async_entries(DOMAIN) == []


async def test_preview_json_rejects_unsupported_request_method(hass: HomeAssistant, hass_ws_client) -> None:
    """Reject methods outside the intentionally supported GET/POST surface."""
    flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert flow["step_id"] == "user"
    fetch = AsyncMock()
    client = await hass_ws_client(hass)
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=fetch):
        await client.send_json({"id":1,"type":f"{DOMAIN}/preview_json",CONF_URL:"https://example.test/data.json",CONF_METHOD:"PUT"})
        message = await client.receive_json()
    assert message["success"] is False
    assert message["error"]["code"] == "invalid_format"
    fetch.assert_not_awaited()
