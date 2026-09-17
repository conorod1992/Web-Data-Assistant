"""Diagnostics support for Web Data Assistant."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

from homeassistant.core import HomeAssistant

from . import WebDataAssistantConfigEntry
from .const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_HEADERS,
    CONF_MAX_STALE_MINUTES,
    CONF_METHOD,
    CONF_PAYLOAD,
    CONF_SCAN_INTERVAL,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VERIFY_SSL,
)


def _safe_url(value: str | None) -> str | None:
    """Return a URL without credentials, query parameters, or fragments."""
    if not value:
        return None
    parts = urlsplit(value)
    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"
    return urlunsplit((parts.scheme, host, parts.path, "", ""))


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant,
    entry: WebDataAssistantConfigEntry,
) -> dict[str, Any]:
    """Return diagnostics for a Web Data Assistant config entry."""
    coordinator = entry.runtime_data
    return {
        "entry": {
            "title": entry.title,
            "source_type": entry.data.get(CONF_SOURCE_TYPE),
            "url": _safe_url(entry.data.get(CONF_URL)),
            "method": entry.data.get(CONF_METHOD),
            "verify_ssl": entry.data.get(CONF_VERIFY_SSL),
            "has_headers": bool(entry.data.get(CONF_HEADERS)),
            "has_payload": bool(entry.data.get(CONF_PAYLOAD)),
            "scan_interval": entry.options.get(
                CONF_SCAN_INTERVAL, entry.data.get(CONF_SCAN_INTERVAL)
            ),
            "failure_mode": entry.options.get(
                CONF_FAILURE_MODE, entry.data.get(CONF_FAILURE_MODE)
            ),
            "max_stale_minutes": entry.options.get(
                CONF_MAX_STALE_MINUTES, entry.data.get(CONF_MAX_STALE_MINUTES)
            ),
            "entities": entry.data.get(CONF_ENTITIES, []),
        },
        "runtime": {
            "last_update_success": coordinator.last_update_success,
            "last_successful_update": (
                coordinator.last_successful_update.isoformat()
                if coordinator.last_successful_update
                else None
            ),
            "has_source_error": coordinator.last_source_error is not None,
            "extraction_error_keys": (
                sorted(coordinator.data.extraction_errors)
                if coordinator.data is not None
                else []
            ),
        },
    }
