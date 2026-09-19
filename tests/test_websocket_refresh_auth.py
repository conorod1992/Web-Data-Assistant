"""Authorization and error coverage for Web Data Assistant source refresh."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.web_data_assistant.client import WebDataConnectionError
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


async def test_refresh_source_requires_admin(
    hass: HomeAssistant,
    hass_ws_client,
    hass_read_only_access_token: str,
) -> None:
    """Reject manual source refresh for a non-admin Home Assistant user."""
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
                    CONF_PATH: "/temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
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
    fetch = AsyncMock(return_value=response)
    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

        client = await hass_ws_client(hass, hass_read_only_access_token)
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/refresh_source",
                "entry_id": entry.entry_id,
            }
        )
        message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "unauthorized"
    assert fetch.await_count == 1


async def test_refresh_source_reports_missing_entry(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Return a stable not_found error when dashboard state references a removed source."""
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json(
        {
            "id": 1,
            "type": f"{DOMAIN}/refresh_source",
            "entry_id": "missing-entry",
        }
    )
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "not_found"
    assert message["error"]["message"] == "Source was not found"


async def test_refresh_source_reports_unloaded_entry(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Return a stable not_loaded error for a configured source that is not running."""
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()

    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Stopped Weather API",
        data={
            CONF_SOURCE_NAME: "Stopped Weather API",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/weather.json",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "temperature",
                    "name": "Temperature",
                    CONF_PATH: "/temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                }
            ],
        },
    )
    entry.add_to_hass(hass)

    client = await hass_ws_client(hass)
    await client.send_json(
        {
            "id": 1,
            "type": f"{DOMAIN}/refresh_source",
            "entry_id": entry.entry_id,
        }
    )
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "not_loaded"
    assert message["error"]["message"] == "Source is not currently loaded"


async def test_refresh_source_outage_returns_unavailable_snapshot(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Represent an ordinary source outage in the refreshed snapshot, not as a WS error."""
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
                    CONF_PATH: "/temperature",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
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
    fetch = AsyncMock(return_value=response)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        fetch.side_effect = WebDataConnectionError("Source returned HTTP 503")

        client = await hass_ws_client(hass)
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/refresh_source",
                "entry_id": entry.entry_id,
            }
        )
        message = await client.receive_json()

    assert message["success"] is True
    assert message["result"]["entry_id"] == entry.entry_id
    assert message["result"]["source_available"] is False
    assert message["result"]["source_error"] == "Source returned HTTP 503"
    assert fetch.await_count == 2
