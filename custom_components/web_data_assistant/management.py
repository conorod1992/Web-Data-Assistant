"""Admin-only source management API for Web Data Assistant."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant

from .const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_HEADERS,
    CONF_LONG_TEXT_POLICY,
    CONF_MAX_STALE_MINUTES,
    CONF_METHOD,
    CONF_PAYLOAD,
    CONF_SCAN_INTERVAL,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VERIFY_SSL,
    DATA_MANAGEMENT_REGISTERED,
    DEFAULT_FAILURE_MODE,
    DEFAULT_LONG_TEXT_POLICY,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    DEFAULT_VERIFY_SSL,
    DOMAIN,
    METHOD_GET,
)
from .coordinator import WebDataCoordinator


def _safe_display_url(value: str) -> str:
    """Return a URL suitable for UI display without credentials/query secrets."""
    parts = urlsplit(value)
    hostname = parts.hostname or ""
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"
    netloc = hostname
    if parts.port is not None:
        netloc = f"{netloc}:{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path or "/", "", ""))


def _find_entry(hass: HomeAssistant, entry_id: str) -> ConfigEntry | None:
    """Return one Web Data Assistant config entry by ID."""
    return next(
        (
            entry
            for entry in hass.config_entries.async_entries(DOMAIN)
            if entry.entry_id == entry_id
        ),
        None,
    )


def _entry_snapshot(entry: ConfigEntry) -> dict[str, Any]:
    """Return non-sensitive management metadata for one source entry."""
    coordinator: WebDataCoordinator | None = None
    if entry.state == ConfigEntryState.LOADED:
        coordinator = entry.runtime_data

    last_successful_update = None
    source_available = False
    extraction_error_count = 0
    if coordinator is not None:
        source_available = coordinator.last_update_success
        if coordinator.last_successful_update is not None:
            last_successful_update = coordinator.last_successful_update.isoformat()
        if coordinator.data is not None:
            extraction_error_count = len(coordinator.data.extraction_errors)

    return {
        "entry_id": entry.entry_id,
        "title": entry.title,
        "state": entry.state.value,
        "source_type": entry.data.get(CONF_SOURCE_TYPE),
        "url": _safe_display_url(str(entry.data.get(CONF_URL, ""))),
        "entity_count": len(entry.data.get(CONF_ENTITIES, [])),
        "scan_interval": entry.options.get(
            CONF_SCAN_INTERVAL,
            entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL_MINUTES),
        ),
        "failure_mode": entry.options.get(
            CONF_FAILURE_MODE,
            entry.data.get(CONF_FAILURE_MODE, DEFAULT_FAILURE_MODE),
        ),
        "max_stale_minutes": entry.options.get(
            CONF_MAX_STALE_MINUTES,
            entry.data.get(CONF_MAX_STALE_MINUTES),
        ),
        "source_available": source_available,
        "extraction_error_count": extraction_error_count,
        "last_successful_update": last_successful_update,
    }


def _editable_source(entry: ConfigEntry) -> dict[str, Any]:
    """Return the full stored source config for an explicit admin edit action."""
    return {
        "entry_id": entry.entry_id,
        "source_name": entry.data.get(CONF_SOURCE_NAME, entry.title),
        "source_type": entry.data.get(CONF_SOURCE_TYPE),
        "url": entry.data.get(CONF_URL, ""),
        "method": entry.data.get(CONF_METHOD, METHOD_GET),
        "headers": entry.data.get(CONF_HEADERS, {}),
        "payload": entry.data.get(CONF_PAYLOAD),
        "verify_ssl": entry.data.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
        "scan_interval": entry.options.get(
            CONF_SCAN_INTERVAL,
            entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL_MINUTES),
        ),
        "failure_mode": entry.options.get(
            CONF_FAILURE_MODE,
            entry.data.get(CONF_FAILURE_MODE, DEFAULT_FAILURE_MODE),
        ),
        "max_stale_minutes": entry.options.get(
            CONF_MAX_STALE_MINUTES,
            entry.data.get(CONF_MAX_STALE_MINUTES),
        ),
        "long_text_policy": entry.options.get(
            CONF_LONG_TEXT_POLICY,
            entry.data.get(CONF_LONG_TEXT_POLICY, DEFAULT_LONG_TEXT_POLICY),
        ),
        "entities": entry.data.get(CONF_ENTITIES, []),
    }


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/list_sources"}
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_list_sources(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return configured sources without exposing credentials or fetched values."""
    entries = hass.config_entries.async_entries(DOMAIN)
    connection.send_result(
        msg["id"],
        {"sources": [_entry_snapshot(entry) for entry in entries]},
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/get_source",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_get_source(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return full editable source config only for an explicit admin request."""
    entry = _find_entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Source was not found")
        return
    connection.send_result(msg["id"], _editable_source(entry))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/refresh_source",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_refresh_source(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Request an immediate refresh for one loaded source."""
    entry = _find_entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Source was not found")
        return
    if entry.state != ConfigEntryState.LOADED:
        connection.send_error(
            msg["id"],
            "not_loaded",
            "Source is not currently loaded",
        )
        return

    coordinator: WebDataCoordinator = entry.runtime_data
    await coordinator.async_request_refresh()
    connection.send_result(msg["id"], _entry_snapshot(entry))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/delete_source",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_delete_source(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Remove one source through Home Assistant's config-entry lifecycle."""
    entry = _find_entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Source was not found")
        return

    await hass.config_entries.async_remove(entry.entry_id)
    connection.send_result(msg["id"], {"entry_id": entry.entry_id})


def async_register_management_commands(hass: HomeAssistant) -> None:
    """Register source-management WebSocket commands once."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_MANAGEMENT_REGISTERED):
        return

    websocket_api.async_register_command(hass, websocket_list_sources)
    websocket_api.async_register_command(hass, websocket_get_source)
    websocket_api.async_register_command(hass, websocket_refresh_source)
    websocket_api.async_register_command(hass, websocket_delete_source)
    domain_data[DATA_MANAGEMENT_REGISTERED] = True
