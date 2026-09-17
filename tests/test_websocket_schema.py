"""Schema-boundary tests for Web Data Assistant WebSocket commands."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant

from custom_components.web_data_assistant.const import DOMAIN


async def test_preview_json_rejects_non_http_url(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Reject non-HTTP(S) URLs before any preview fetch occurs."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    fetch = AsyncMock()
    client = await hass_ws_client(hass)
    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/preview_json",
                "url": "ftp://example.test/data.json",
            }
        )
        message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "invalid_format"
    fetch.assert_not_awaited()
    assert hass.config_entries.async_entries(DOMAIN) == []
