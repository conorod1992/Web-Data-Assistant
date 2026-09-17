"""Authorization coverage for Web Data Assistant guided previews."""

from __future__ import annotations

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant

from custom_components.web_data_assistant.const import DOMAIN


async def test_preview_json_requires_admin(
    hass: HomeAssistant,
    hass_ws_client,
    hass_read_only_access_token: str,
) -> None:
    """Reject guided JSON preview requests from a non-admin user."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json(
        {
            "id": 1,
            "type": f"{DOMAIN}/preview_json",
            "url": "https://example.test/data.json",
        }
    )
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "unauthorized"


async def test_preview_html_requires_admin(
    hass: HomeAssistant,
    hass_ws_client,
    hass_read_only_access_token: str,
) -> None:
    """Reject guided HTML preview requests from a non-admin user."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json(
        {
            "id": 1,
            "type": f"{DOMAIN}/preview_html",
            "url": "https://example.test/page",
        }
    )
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "unauthorized"


async def test_search_html_requires_admin(
    hass: HomeAssistant,
    hass_ws_client,
    hass_read_only_access_token: str,
) -> None:
    """Reject guided HTML text-search requests from a non-admin user."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json(
        {
            "id": 1,
            "type": f"{DOMAIN}/search_html",
            "url": "https://example.test/page",
            "search_text": "14°C",
        }
    )
    message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "unauthorized"
