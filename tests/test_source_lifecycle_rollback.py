"""Failure-safety coverage for Web Data Assistant source editing."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_PATH,
    CONF_SCAN_INTERVAL,
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


def _response() -> FetchResponse:
    return FetchResponse(
        status=200,
        content_type="application/json",
        text='{"temperature":14.6}',
        json_data={"temperature": 14.6},
    )


def _entry() -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title="Original Weather",
        data={
            CONF_SOURCE_NAME: "Original Weather",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/original.json",
            CONF_SCAN_INTERVAL: 5,
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


async def test_update_source_restores_previous_config_when_reload_fails(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """A failed edited reload must leave the previously working config persisted."""
    entry = _entry()
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response()),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

        original_data = dict(entry.data)
        original_title = entry.title
        original_options = dict(entry.options)
        real_reload = hass.config_entries.async_reload
        reload_calls = 0

        async def reload_with_first_failure(entry_id: str) -> bool:
            nonlocal reload_calls
            reload_calls += 1
            if reload_calls == 1:
                return False
            return await real_reload(entry_id)

        client = await hass_ws_client(hass)
        with patch.object(
            hass.config_entries,
            "async_reload",
            side_effect=reload_with_first_failure,
        ):
            await client.send_json(
                {
                    "id": 1,
                    "type": f"{DOMAIN}/update_source",
                    "entry_id": entry.entry_id,
                    CONF_SOURCE_NAME: "Broken Edit",
                    CONF_SOURCE_TYPE: SOURCE_JSON,
                    CONF_URL: "https://example.test/edited.json",
                    CONF_SCAN_INTERVAL: 30,
                    CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
                    CONF_ENTITIES: [
                        {
                            "key": "temperature",
                            "name": "Changed Temperature",
                            CONF_PATH: "/temperature",
                            CONF_VALUE_TYPE: VALUE_NUMBER,
                        }
                    ],
                }
            )
            message = await client.receive_json()
            await hass.async_block_till_done()

    assert message["success"] is False
    assert message["error"]["code"] == "reload_failed"
    restored = hass.config_entries.async_get_entry(entry.entry_id)
    assert restored is not None
    assert restored.title == original_title
    assert dict(restored.data) == original_data
    assert dict(restored.options) == original_options
    assert reload_calls == 2


async def test_update_source_rejects_whitespace_only_name(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Apply the same non-empty source-name rule to Edit as to Create."""
    entry = _entry()
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response()),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json(
        {
            "id": 1,
            "type": f"{DOMAIN}/update_source",
            "entry_id": entry.entry_id,
            CONF_SOURCE_NAME: "   ",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/edited.json",
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
    assert message["error"]["code"] == "invalid_format"
    assert hass.config_entries.async_get_entry(entry.entry_id).title == "Original Weather"
