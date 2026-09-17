"""Real Home Assistant config-flow tests for Web Data Assistant."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_HEADERS,
    CONF_MAX_STALE_MINUTES,
    CONF_METHOD,
    CONF_PATH,
    CONF_SCAN_INTERVAL,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    CONF_VERIFY_SSL,
    DOMAIN,
    FAILURE_KEEP_LAST,
    METHOD_GET,
    SOURCE_JSON,
    VALUE_NUMBER,
)
from custom_components.web_data_assistant.frontend import PANEL_URL_PATH
from custom_components.web_data_assistant.models import FetchResponse


async def test_guided_json_config_flow_persists_selected_value(
    hass: HomeAssistant,
) -> None:
    """Create a JSON source through Home Assistant's real config-flow engine."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"
    assert PANEL_URL_PATH in hass.data.get("frontend_panels", {})

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {
            CONF_SOURCE_NAME: "Weather API",
            CONF_SOURCE_TYPE: SOURCE_JSON,
        },
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "source"

    response = FetchResponse(
        status=200,
        content_type="application/json",
        text='{"current":{"temperature":14.6,"condition":"Cloudy"}}',
        json_data={"current": {"temperature": 14.6, "condition": "Cloudy"}},
    )
    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ) as fetch:
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"],
            {
                CONF_URL: "https://example.test/weather.json",
                CONF_METHOD: METHOD_GET,
                CONF_HEADERS: "",
                CONF_VERIFY_SSL: True,
            },
        )

    fetch.assert_awaited_once()
    assert result["type"] is FlowResultType.MENU
    assert result["step_id"] == "json_mode"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {"next_step_id": "json_values"},
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "json_values"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {"selected_values": ["/current/temperature"]},
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "behaviour"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {
            CONF_SCAN_INTERVAL: 15,
            CONF_FAILURE_MODE: FAILURE_KEEP_LAST,
            CONF_MAX_STALE_MINUTES: 90,
        },
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Weather API"

    data = result["data"]
    assert data[CONF_SOURCE_NAME] == "Weather API"
    assert data[CONF_SOURCE_TYPE] == SOURCE_JSON
    assert data[CONF_URL] == "https://example.test/weather.json"
    assert data[CONF_METHOD] == METHOD_GET
    assert data[CONF_HEADERS] == {}
    assert data[CONF_VERIFY_SSL] is True
    assert data[CONF_SCAN_INTERVAL] == 15
    assert data[CONF_FAILURE_MODE] == FAILURE_KEEP_LAST
    assert data[CONF_MAX_STALE_MINUTES] == 90

    entities = data[CONF_ENTITIES]
    assert len(entities) == 1
    assert entities[0][CONF_PATH] == "/current/temperature"
    assert entities[0][CONF_VALUE_TYPE] == VALUE_NUMBER


async def test_config_flow_rejects_invalid_source_url(hass: HomeAssistant) -> None:
    """Reject non-HTTP source URLs before attempting a network request."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {
            CONF_SOURCE_NAME: "Invalid source",
            CONF_SOURCE_TYPE: SOURCE_JSON,
        },
    )

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(),
    ) as fetch:
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"],
            {
                CONF_URL: "file:///tmp/data.json",
                CONF_METHOD: METHOD_GET,
                CONF_HEADERS: "",
                CONF_VERIFY_SSL: True,
            },
        )

    fetch.assert_not_awaited()
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "source"
    assert result["errors"] == {CONF_URL: "invalid_url"}
