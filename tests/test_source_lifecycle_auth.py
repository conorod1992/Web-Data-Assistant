"""Authorization coverage for Web Data Assistant source lifecycle management."""

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
from custom_components.web_data_assistant.models import FetchResponse


def _entry() -> MockConfigEntry:
    """Build a simple configured source for lifecycle authorization tests."""
    return MockConfigEntry(
        domain=DOMAIN,
        title="Weather",
        data={
            CONF_SOURCE_NAME: "Weather",
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
        },
    )


def _response() -> FetchResponse:
    """Return one valid response for initial entry setup."""
    return FetchResponse(
        status=200,
        content_type="application/json",
        text='{"temperature":14.6}',
        json_data={"temperature": 14.6},
    )


async def _setup_entry(hass: HomeAssistant) -> MockConfigEntry:
    """Add and load a lifecycle test entry."""
    entry = _entry()
    entry.add_to_hass(hass)
    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response()),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    return entry


async def test_get_source_requires_admin(
    hass: HomeAssistant,
    hass_ws_client,
    hass_read_only_access_token: str,
) -> None:
    """Never expose stored request credentials/config to a non-admin user."""
    entry = await _setup_entry(hass)
    client = await hass_ws_client(hass, hass_read_only_access_token)

    await client.send_json(
        {"id": 1, "type": f"{DOMAIN}/get_source", "entry_id": entry.entry_id}
    )
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "unauthorized"


async def test_update_source_requires_admin_before_validation_fetch(
    hass: HomeAssistant,
    hass_ws_client,
    hass_read_only_access_token: str,
) -> None:
    """Reject source edits before a non-admin can trigger a validation request."""
    entry = await _setup_entry(hass)
    client = await hass_ws_client(hass, hass_read_only_access_token)
    fetch = AsyncMock(return_value=_response())

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/update_source",
                "entry_id": entry.entry_id,
                CONF_SOURCE_NAME: "Changed",
                CONF_SOURCE_TYPE: SOURCE_JSON,
                CONF_URL: "https://example.test/changed.json",
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
    assert fetch.await_count == 0
    assert hass.config_entries.async_get_entry(entry.entry_id).title == "Weather"


async def test_delete_source_requires_admin(
    hass: HomeAssistant,
    hass_ws_client,
    hass_read_only_access_token: str,
) -> None:
    """Reject source deletion for a non-admin Home Assistant user."""
    entry = await _setup_entry(hass)
    client = await hass_ws_client(hass, hass_read_only_access_token)

    await client.send_json(
        {"id": 1, "type": f"{DOMAIN}/delete_source", "entry_id": entry.entry_id}
    )
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "unauthorized"
    assert hass.config_entries.async_get_entry(entry.entry_id) is not None
