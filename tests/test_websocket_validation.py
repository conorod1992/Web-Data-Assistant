"""Real Home Assistant WebSocket validation tests for Web Data Assistant."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_PATH,
    CONF_SELECTOR,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    DOMAIN,
    FAILURE_UNAVAILABLE,
    SOURCE_JSON,
    SOURCE_SCRAPE,
    VALUE_NUMBER,
    VALUE_TEXT,
)
from custom_components.web_data_assistant.models import FetchResponse


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


async def test_create_source_rejects_json_entity_without_path_or_attributes(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Reject a JSON sensor that has neither a state path nor attributes."""
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
            CONF_SOURCE_NAME: "Missing Path",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/data.json",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                }
            ],
        }
    )
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "invalid_entities"
    assert "state path" in message["error"]["message"]
    assert "attributes" in message["error"]["message"]
    assert hass.config_entries.async_entries(DOMAIN) == []


async def test_create_source_rejects_scrape_entity_without_selector(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Reject a web-page sensor definition that omits its CSS selector."""
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
            CONF_SOURCE_NAME: "Missing Selector",
            CONF_SOURCE_TYPE: SOURCE_SCRAPE,
            CONF_URL: "https://example.test/page",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_VALUE_TYPE: VALUE_TEXT,
                }
            ],
        }
    )
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "invalid_entities"
    assert "missing its selector" in message["error"]["message"]
    assert hass.config_entries.async_entries(DOMAIN) == []


async def test_create_source_rejects_json_path_absent_from_sample(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Reject a selected JSON path that is not present in the validation response."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    response = FetchResponse(
        status=200,
        content_type="application/json",
        text='{"temperature":14.6}',
        json_data={"temperature": 14.6},
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
                CONF_SOURCE_NAME: "Missing Sample Value",
                CONF_SOURCE_TYPE: SOURCE_JSON,
                CONF_URL: "https://example.test/data.json",
                CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
                CONF_ENTITIES: [
                    {
                        "key": "humidity",
                        "name": "Humidity",
                        CONF_PATH: "/humidity",
                        CONF_VALUE_TYPE: VALUE_NUMBER,
                    }
                ],
            }
        )
        message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "validation_failed"
    assert hass.config_entries.async_entries(DOMAIN) == []


async def test_create_source_rejects_scrape_selector_absent_from_sample(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Reject a selected CSS selector that no longer matches the validation page."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    response = FetchResponse(
        status=200,
        content_type="text/html",
        text="<html><body><span class='humidity'>82%</span></body></html>",
        json_data=None,
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
                CONF_SOURCE_NAME: "Missing Scrape Value",
                CONF_SOURCE_TYPE: SOURCE_SCRAPE,
                CONF_URL: "https://example.test/page",
                CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
                CONF_ENTITIES: [
                    {
                        "key": "temperature",
                        "name": "Temperature",
                        CONF_SELECTOR: ".temperature",
                        CONF_VALUE_TYPE: VALUE_TEXT,
                    }
                ],
            }
        )
        message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "validation_failed"
    assert hass.config_entries.async_entries(DOMAIN) == []


async def test_list_sources_requires_admin(
    hass: HomeAssistant,
    hass_ws_client,
    hass_read_only_access_token: str,
) -> None:
    """Reject source-management listing for a non-admin Home Assistant user."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/list_sources"})
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "unauthorized"


async def test_create_source_requires_admin(
    hass: HomeAssistant,
    hass_ws_client,
    hass_read_only_access_token: str,
) -> None:
    """Reject source creation for a non-admin Home Assistant user."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json(
        {
            "id": 1,
            "type": f"{DOMAIN}/create_source",
            CONF_SOURCE_NAME: "Unauthorized Source",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/data.json",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_PATH: "/temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                }
            ],
        }
    )
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "unauthorized"
    assert hass.config_entries.async_entries(DOMAIN) == []



async def test_create_source_accepts_multiple_scrape_entities(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Create multiple scrape sensors from one validated page source."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    response = FetchResponse(
        status=200,
        content_type="text/html",
        text=(
            '<html><body><span class="temperature">14°C</span>'
            '<span class="humidity">82%</span></body></html>'
        ),
        json_data=None,
    )
    fetch = AsyncMock(return_value=response)
    client = await hass_ws_client(hass)
    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/create_source",
                CONF_SOURCE_NAME: "Page Weather",
                CONF_SOURCE_TYPE: SOURCE_SCRAPE,
                CONF_URL: "https://example.test/weather",
                CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
                CONF_ENTITIES: [
                    {
                        "key": "temperature",
                        "name": "Temperature",
                        CONF_SELECTOR: ".temperature",
                        CONF_VALUE_TYPE: VALUE_TEXT,
                    },
                    {
                        "key": "humidity",
                        "name": "Humidity",
                        CONF_SELECTOR: ".humidity",
                        CONF_VALUE_TYPE: VALUE_TEXT,
                    },
                ],
            }
        )
        message = await client.receive_json()
        assert message["success"] is True
        entry_id = message["result"]["entry_id"]
        await hass.async_block_till_done()

    entry = hass.config_entries.async_get_entry(entry_id)
    assert entry is not None
    assert [entity["key"] for entity in entry.data[CONF_ENTITIES]] == [
        "temperature",
        "humidity",
    ]

    registry = er.async_get(hass)
    temperature_id = registry.async_get_entity_id(
        "sensor", DOMAIN, f"{entry_id}_temperature"
    )
    humidity_id = registry.async_get_entity_id(
        "sensor", DOMAIN, f"{entry_id}_humidity"
    )
    assert temperature_id is not None
    assert humidity_id is not None
    assert hass.states[temperature_id].state == "14°C"
    assert hass.states[humidity_id].state == "82%"
    assert fetch.await_count >= 2
