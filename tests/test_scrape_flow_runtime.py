"""Real Home Assistant guided scrape config-flow tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_HEADERS,
    CONF_INDEX,
    CONF_METHOD,
    CONF_SCAN_INTERVAL,
    CONF_SEARCH_TEXT,
    CONF_SELECTOR,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    CONF_VERIFY_SSL,
    DOMAIN,
    FAILURE_UNAVAILABLE,
    METHOD_GET,
    SOURCE_SCRAPE,
    VALUE_TEXT,
)
from custom_components.web_data_assistant.models import FetchResponse


async def test_guided_scrape_flow_finds_visible_text_and_persists_selector(
    hass: HomeAssistant,
) -> None:
    """Create a scrape source through HA's real config-flow engine."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {
            CONF_SOURCE_NAME: "Service Status",
            CONF_SOURCE_TYPE: SOURCE_SCRAPE,
        },
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "source"

    response = FetchResponse(
        status=200,
        content_type="text/html",
        text=(
            '<html><body><main><h1>Status</h1>'
            '<span class="service-status">Online</span>'
            '<span class="availability">99%</span>'
            '</main></body></html>'
        ),
        json_data=None,
    )
    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ) as fetch:
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"],
            {
                CONF_URL: "https://example.test/status",
                CONF_METHOD: METHOD_GET,
                CONF_HEADERS: "",
                CONF_VERIFY_SSL: True,
            },
        )

    fetch.assert_awaited_once()
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "scrape_search"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_SEARCH_TEXT: "Online"},
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "scrape_value"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {
            "sensor_name": "Service Status",
            "unit": "",
            "add_another": True,
        },
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "scrape_search"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_SEARCH_TEXT: "99%"},
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "scrape_value"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {
            "sensor_name": "Availability",
            "unit": "%",
            "add_another": False,
        },
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "behaviour"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {
            CONF_SCAN_INTERVAL: 10,
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
        },
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Service Status"

    data = result["data"]
    assert data[CONF_SOURCE_TYPE] == SOURCE_SCRAPE
    assert data[CONF_URL] == "https://example.test/status"
    assert data[CONF_SCAN_INTERVAL] == 10
    assert data[CONF_FAILURE_MODE] == FAILURE_UNAVAILABLE

    entities = data[CONF_ENTITIES]
    assert len(entities) == 2
    status, availability = entities
    assert status["name"] == "Service Status"
    assert status[CONF_SELECTOR] == "span.service-status"
    assert status[CONF_INDEX] == 0
    assert status[CONF_VALUE_TYPE] == VALUE_TEXT
    assert availability["name"] == "Availability"
    assert availability[CONF_SELECTOR] == "span.availability"
    assert availability[CONF_INDEX] == 0
    assert availability[CONF_VALUE_TYPE] == VALUE_TEXT
    assert availability["unit"] == "%"
