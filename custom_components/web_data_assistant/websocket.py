"""WebSocket API used by the Web Data Assistant guided frontend."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .client import WebDataClient, WebDataError
from .const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_HEADERS,
    CONF_INDEX,
    CONF_MAX_STALE_MINUTES,
    CONF_METHOD,
    CONF_PATH,
    CONF_PAYLOAD,
    CONF_SCAN_INTERVAL,
    CONF_SELECTOR,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    CONF_VERIFY_SSL,
    DEFAULT_FAILURE_MODE,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    DEFAULT_VERIFY_SSL,
    DOMAIN,
    METHOD_GET,
    SOURCE_JSON,
    SOURCE_SCRAPE,
    VALUE_TEXT,
)
from .extraction import extract_html_value, iter_json_candidates, resolve_json_pointer
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


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/create_source",
        vol.Required(CONF_SOURCE_NAME): str,
        vol.Required(CONF_SOURCE_TYPE): vol.In([SOURCE_JSON, SOURCE_SCRAPE]),
        vol.Required(CONF_ENTITIES): [dict],
        vol.Optional(CONF_SCAN_INTERVAL, default=DEFAULT_SCAN_INTERVAL_MINUTES): int,
        vol.Optional(CONF_FAILURE_MODE, default=DEFAULT_FAILURE_MODE): str,
        vol.Optional(CONF_MAX_STALE_MINUTES): int,
        **_COMMON_FIELDS,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_create_source(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Validate a panel-built source and create it through the config flow."""
    source_type = msg[CONF_SOURCE_TYPE]
    entities = msg[CONF_ENTITIES]
    if not entities:
        connection.send_error(msg["id"], "invalid_entities", "Choose at least one value")
        return

    client = WebDataClient(hass)
    try:
        response = await client.async_fetch(
            msg[CONF_URL],
            method=msg.get(CONF_METHOD, METHOD_GET),
            headers=msg.get(CONF_HEADERS),
            payload=msg.get(CONF_PAYLOAD),
            verify_ssl=msg.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
            parse_json=source_type == SOURCE_JSON,
        )
        for entity in entities:
            if source_type == SOURCE_JSON:
                path = entity.get(CONF_PATH)
                if path is None:
                    raise ValueError("A selected JSON value is missing its path")
                resolve_json_pointer(response.json_data, str(path))
            else:
                selector = entity.get(CONF_SELECTOR)
                if not selector:
                    raise ValueError("A selected page value is missing its selector")
                extract_html_value(
                    response.text,
                    str(selector),
                    int(entity.get(CONF_INDEX, 0)),
                )
    except (WebDataError, KeyError, TypeError, ValueError) as err:
        connection.send_error(msg["id"], "validation_failed", str(err))
        return

    data: dict[str, Any] = {
        "_panel_create": True,
        CONF_SOURCE_NAME: msg[CONF_SOURCE_NAME].strip(),
        CONF_SOURCE_TYPE: source_type,
        CONF_URL: msg[CONF_URL],
        CONF_METHOD: msg.get(CONF_METHOD, METHOD_GET),
        CONF_HEADERS: msg.get(CONF_HEADERS, {}),
        CONF_VERIFY_SSL: msg.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
        CONF_SCAN_INTERVAL: max(1, int(msg.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL_MINUTES))),
        CONF_FAILURE_MODE: msg.get(CONF_FAILURE_MODE, DEFAULT_FAILURE_MODE),
        CONF_ENTITIES: entities,
    }
    if payload := msg.get(CONF_PAYLOAD):
        data[CONF_PAYLOAD] = payload
    if stale := msg.get(CONF_MAX_STALE_MINUTES):
        data[CONF_MAX_STALE_MINUTES] = max(1, int(stale))

    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_USER},
        data=data,
    )
    entry = result.get("result")
    entry_id = getattr(entry, "entry_id", None)
    if entry_id is None:
        connection.send_error(
            msg["id"],
            "create_failed",
            "Home Assistant did not create the source entry",
        )
        return

    connection.send_result(msg["id"], {"entry_id": entry_id})


def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register frontend preview commands once for the integration."""
    websocket_api.async_register_command(hass, websocket_preview_json)
    websocket_api.async_register_command(hass, websocket_preview_html)
    websocket_api.async_register_command(hass, websocket_create_source)
