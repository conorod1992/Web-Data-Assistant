"""WebSocket API used by the Web Data Assistant guided frontend."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .client import WebDataClient, WebDataError
from .const import (
    CONF_HEADERS,
    CONF_METHOD,
    CONF_PAYLOAD,
    CONF_URL,
    CONF_VERIFY_SSL,
    DEFAULT_VERIFY_SSL,
    DOMAIN,
    METHOD_GET,
)
from .extraction import iter_json_candidates
from .preview import build_html_preview


_COMMON_FIELDS: dict[Any, Any] = {
    vol.Required(CONF_URL): str,
    vol.Optional(CONF_METHOD, default=METHOD_GET): str,
    vol.Optional(CONF_HEADERS): dict,
    vol.Optional(CONF_PAYLOAD): str,
    vol.Optional(CONF_VERIFY_SSL, default=DEFAULT_VERIFY_SSL): bool,
}


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/preview_json",
        **_COMMON_FIELDS,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_preview_json(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Fetch JSON and return values suitable for guided selection."""
    client = WebDataClient(hass)
    try:
        response = await client.async_fetch(
            msg[CONF_URL],
            method=msg.get(CONF_METHOD, METHOD_GET),
            headers=msg.get(CONF_HEADERS),
            payload=msg.get(CONF_PAYLOAD),
            verify_ssl=msg.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
            parse_json=True,
        )
    except WebDataError as err:
        connection.send_error(msg["id"], "fetch_failed", str(err))
        return

    candidates = [
        {
            "path": candidate.path,
            "display_path": candidate.display_path,
            "preview": candidate.preview,
            "value_type": type(candidate.value).__name__,
        }
        for candidate in iter_json_candidates(response.json_data)
    ]
    connection.send_result(
        msg["id"],
        {
            "status": response.status,
            "content_type": response.content_type,
            "values": candidates,
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/preview_html",
        **_COMMON_FIELDS,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_preview_html(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Fetch HTML and return a sanitised, clickable preview document."""
    client = WebDataClient(hass)
    try:
        response = await client.async_fetch(
            msg[CONF_URL],
            method=msg.get(CONF_METHOD, METHOD_GET),
            headers=msg.get(CONF_HEADERS),
            payload=msg.get(CONF_PAYLOAD),
            verify_ssl=msg.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
            parse_json=False,
        )
        preview_html, elements = build_html_preview(response.text, msg[CONF_URL])
    except WebDataError as err:
        connection.send_error(msg["id"], "fetch_failed", str(err))
        return
    except (TypeError, ValueError) as err:
        connection.send_error(msg["id"], "preview_failed", str(err))
        return

    connection.send_result(
        msg["id"],
        {
            "status": response.status,
            "content_type": response.content_type,
            "html": preview_html,
            "elements": {
                preview_id: element.as_dict()
                for preview_id, element in elements.items()
            },
        },
    )


def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register frontend preview commands once for the integration."""
    websocket_api.async_register_command(hass, websocket_preview_json)
    websocket_api.async_register_command(hass, websocket_preview_html)
