"""Admin-only source management API for Web Data Assistant."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from .client import WebDataClient, WebDataError
from .const import (
    CONF_ATTRIBUTES,
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_HEADERS,
    CONF_LONG_TEXT_POLICY,
    CONF_MAX_STALE_MINUTES,
    CONF_METHOD,
    CONF_INDEX,
    CONF_PATH,
    CONF_PAYLOAD,
    CONF_SELECTOR,
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
    FAILURE_KEEP_LAST,
    METHOD_GET,
    SOURCE_JSON,
)
from .coordinator import WebDataCoordinator
from .extraction import extract_html_entities, resolve_json_pointer
from .models import WebDataEntityConfig
from .websocket import (
    _COMMON_FIELDS,
    _ENTITY_SCHEMA,
    _fetch_kwargs,
    _non_empty_text,
    _validate_entity_definitions,
)


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
    source_error = None
    extraction_error_count = 0
    extraction_issues: list[dict[str, Any]] = []
    if coordinator is not None:
        source_available = coordinator.last_update_success
        source_error = coordinator.last_source_error
        if coordinator.last_successful_update is not None:
            last_successful_update = coordinator.last_successful_update.isoformat()
        if source_available and coordinator.data is not None:
            extraction_error_count = len(coordinator.data.extraction_errors)
            entities_by_key = {
                str(entity.get("key")): entity
                for entity in entry.data.get(CONF_ENTITIES, [])
            }
            for key, error in coordinator.data.extraction_errors.items():
                entity = entities_by_key.get(str(key), {})
                attributes = entity.get(CONF_ATTRIBUTES, {})
                repairable = bool(
                    (
                        entry.data.get(CONF_SOURCE_TYPE) == SOURCE_JSON
                        and entity.get(CONF_PATH) is not None
                        and not attributes
                    )
                    or (
                        entry.data.get(CONF_SOURCE_TYPE) != SOURCE_JSON
                        and entity.get("selector")
                    )
                )
                if entry.data.get(CONF_SOURCE_TYPE) == SOURCE_JSON:
                    target_parts: list[str] = []
                    if entity.get(CONF_PATH) is not None:
                        target_parts.append(f"State path: {entity[CONF_PATH]}")
                    target_parts.extend(
                        f"Attribute {name}: {path}"
                        for name, path in attributes.items()
                    )
                    target = " · ".join(target_parts) or "JSON extraction"
                else:
                    target = (
                        f"Selector: {entity.get(CONF_SELECTOR, '(missing)')}"
                        f" · match {int(entity.get(CONF_INDEX, 0))}"
                    )
                extraction_issues.append(
                    {
                        "key": str(key),
                        "name": str(entity.get("name") or key),
                        "error": str(error),
                        "target": target,
                        "repairable": repairable,
                    }
                )

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
        "source_error": source_error,
        "extraction_error_count": extraction_error_count,
        "extraction_issues": extraction_issues,
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


async def _validate_update(hass: HomeAssistant, msg: dict[str, Any]) -> None:
    """Validate an edited source against a fresh response before applying it."""
    source_type = msg[CONF_SOURCE_TYPE]
    entities = msg[CONF_ENTITIES]
    _validate_entity_definitions(source_type, entities)

    client = WebDataClient(hass)
    response = await client.async_fetch(
        msg[CONF_URL],
        **_fetch_kwargs(msg),
        parse_json=source_type == SOURCE_JSON,
    )
    if source_type == SOURCE_JSON:
        for entity in entities:
            if CONF_PATH in entity:
                resolve_json_pointer(response.json_data, str(entity[CONF_PATH]))
            for path in entity.get(CONF_ATTRIBUTES, {}).values():
                resolve_json_pointer(response.json_data, str(path))
        return

    entity_configs = [WebDataEntityConfig.from_dict(entity) for entity in entities]
    validation_result = await hass.async_add_executor_job(
        extract_html_entities,
        response.text,
        entity_configs,
    )
    if validation_result.extraction_errors:
        first_key, first_error = next(iter(validation_result.extraction_errors.items()))
        raise ValueError(f"{first_key}: {first_error}")


def _updated_entry_data(msg: dict[str, Any]) -> dict[str, Any]:
    """Build persisted config-entry data from an edit message."""
    data: dict[str, Any] = {
        CONF_SOURCE_NAME: msg[CONF_SOURCE_NAME],
        CONF_SOURCE_TYPE: msg[CONF_SOURCE_TYPE],
        CONF_URL: msg[CONF_URL],
        CONF_METHOD: msg.get(CONF_METHOD, METHOD_GET),
        CONF_HEADERS: msg.get(CONF_HEADERS, {}),
        CONF_VERIFY_SSL: msg.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
        CONF_SCAN_INTERVAL: msg.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL_MINUTES),
        CONF_FAILURE_MODE: msg.get(CONF_FAILURE_MODE, DEFAULT_FAILURE_MODE),
        CONF_LONG_TEXT_POLICY: msg.get(
            CONF_LONG_TEXT_POLICY, DEFAULT_LONG_TEXT_POLICY
        ),
        CONF_ENTITIES: msg[CONF_ENTITIES],
    }
    if payload := msg.get(CONF_PAYLOAD):
        data[CONF_PAYLOAD] = payload
    if (
        msg.get(CONF_FAILURE_MODE, DEFAULT_FAILURE_MODE) == FAILURE_KEEP_LAST
        and (stale := msg.get(CONF_MAX_STALE_MINUTES))
    ):
        data[CONF_MAX_STALE_MINUTES] = stale
    return data


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
        vol.Required("type"): f"{DOMAIN}/update_source",
        vol.Required("entry_id"): str,
        vol.Required(CONF_SOURCE_NAME): vol.All(
            str, _non_empty_text, vol.Length(max=100)
        ),
        vol.Required(CONF_SOURCE_TYPE): vol.In(["json", "scrape"]),
        vol.Required(CONF_ENTITIES): vol.All([_ENTITY_SCHEMA], vol.Length(min=1, max=100)),
        vol.Optional(CONF_SCAN_INTERVAL, default=DEFAULT_SCAN_INTERVAL_MINUTES): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=1440)
        ),
        vol.Optional(CONF_FAILURE_MODE, default=DEFAULT_FAILURE_MODE): vol.In(
            ["unavailable", "keep_last"]
        ),
        vol.Optional(CONF_MAX_STALE_MINUTES): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=525600)
        ),
        vol.Optional(CONF_LONG_TEXT_POLICY, default=DEFAULT_LONG_TEXT_POLICY): vol.In(
            ["truncate", "attribute_only", "unavailable"]
        ),
        **_COMMON_FIELDS,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_update_source(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Validate and update an existing source while preserving its entry identity."""
    entry = _find_entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Source was not found")
        return

    try:
        await _validate_update(hass, msg)
    except (WebDataError, KeyError, TypeError, ValueError) as err:
        connection.send_error(msg["id"], "validation_failed", str(err))
        return

    old_keys = {str(entity["key"]) for entity in entry.data.get(CONF_ENTITIES, [])}
    new_keys = {str(entity["key"]) for entity in msg[CONF_ENTITIES]}
    old_title = entry.title
    old_data = dict(entry.data)
    old_options = dict(entry.options)

    new_options = dict(entry.options)
    for key in (
        CONF_SCAN_INTERVAL,
        CONF_FAILURE_MODE,
        CONF_MAX_STALE_MINUTES,
        CONF_LONG_TEXT_POLICY,
    ):
        new_options.pop(key, None)

    hass.config_entries.async_update_entry(
        entry,
        title=msg[CONF_SOURCE_NAME],
        data=_updated_entry_data(msg),
        options=new_options,
    )
    if not await hass.config_entries.async_reload(entry.entry_id):
        hass.config_entries.async_update_entry(
            entry,
            title=old_title,
            data=old_data,
            options=old_options,
        )
        await hass.config_entries.async_reload(entry.entry_id)
        connection.send_error(
            msg["id"],
            "reload_failed",
            "Home Assistant could not reload the edited source; previous settings were restored",
        )
        return

    registry = er.async_get(hass)
    for key in old_keys - new_keys:
        entity_id = registry.async_get_entity_id(
            "sensor", DOMAIN, f"{entry.entry_id}_{key}"
        )
        if entity_id is not None:
            registry.async_remove(entity_id)

    connection.send_result(msg["id"], _entry_snapshot(entry))


async def _validate_replacement_entity(
    hass: HomeAssistant,
    entry: ConfigEntry,
    entity: dict[str, Any],
) -> None:
    """Validate one replacement extraction without requiring sibling entities to work."""
    source_type = entry.data[CONF_SOURCE_TYPE]
    client = WebDataClient(hass)
    response = await client.async_fetch(
        entry.data[CONF_URL],
        method=entry.data.get(CONF_METHOD, METHOD_GET),
        headers=entry.data.get(CONF_HEADERS),
        payload=entry.data.get(CONF_PAYLOAD),
        verify_ssl=entry.data.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
        parse_json=source_type == SOURCE_JSON,
    )

    if source_type == SOURCE_JSON:
        path = entity.get(CONF_PATH)
        if path is None or entity.get(CONF_ATTRIBUTES):
            raise ValueError(
                "This JSON sensor has multiple extraction paths; use Edit source to repair it"
            )
        resolve_json_pointer(response.json_data, str(path))
        return

    validation = await hass.async_add_executor_job(
        extract_html_entities,
        response.text,
        [WebDataEntityConfig.from_dict(entity)],
    )
    if validation.extraction_errors:
        raise ValueError(next(iter(validation.extraction_errors.values())))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/repair_entity",
        vol.Required("entry_id"): str,
        vol.Required("entity_key"): str,
        vol.Optional(CONF_PATH): str,
        vol.Optional("selector"): str,
        vol.Optional("index", default=0): vol.Coerce(int),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_repair_entity(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Replace one broken extraction while preserving entity identity."""
    entry = _find_entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Source was not found")
        return

    entities = [dict(entity) for entity in entry.data.get(CONF_ENTITIES, [])]
    entity_index = next(
        (
            index
            for index, entity in enumerate(entities)
            if str(entity.get("key")) == msg["entity_key"]
        ),
        None,
    )
    if entity_index is None:
        connection.send_error(msg["id"], "not_found", "Sensor was not found")
        return

    replacement = dict(entities[entity_index])
    source_type = entry.data.get(CONF_SOURCE_TYPE)
    if source_type == SOURCE_JSON:
        if replacement.get(CONF_ATTRIBUTES):
            connection.send_error(
                msg["id"],
                "not_repairable",
                "This JSON sensor has multiple extraction paths; use Edit source to repair it",
            )
            return
        path = msg.get(CONF_PATH)
        if path is None:
            connection.send_error(
                msg["id"], "invalid_replacement", "Choose a JSON value to repair this sensor"
            )
            return
        replacement[CONF_PATH] = path
    else:
        selector = str(msg.get("selector") or "").strip()
        if not selector:
            connection.send_error(
                msg["id"], "invalid_replacement", "Choose a page value to repair this sensor"
            )
            return
        replacement["selector"] = selector
        replacement["index"] = int(msg.get("index", 0))

    try:
        _validate_entity_definitions(source_type, [replacement])
        await _validate_replacement_entity(hass, entry, replacement)
    except (WebDataError, KeyError, TypeError, ValueError) as err:
        connection.send_error(msg["id"], "validation_failed", str(err))
        return

    old_data = dict(entry.data)
    new_data = dict(entry.data)
    entities[entity_index] = replacement
    new_data[CONF_ENTITIES] = entities
    hass.config_entries.async_update_entry(entry, data=new_data)

    if not await hass.config_entries.async_reload(entry.entry_id):
        hass.config_entries.async_update_entry(entry, data=old_data)
        await hass.config_entries.async_reload(entry.entry_id)
        connection.send_error(
            msg["id"],
            "reload_failed",
            "Home Assistant could not reload the repaired sensor; previous settings were restored",
        )
        return

    connection.send_result(
        msg["id"],
        {
            "entry_id": entry.entry_id,
            "entity_key": msg["entity_key"],
            "source": _entry_snapshot(entry),
        },
    )


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
    websocket_api.async_register_command(hass, websocket_update_source)
    websocket_api.async_register_command(hass, websocket_repair_entity)
    websocket_api.async_register_command(hass, websocket_refresh_source)
    websocket_api.async_register_command(hass, websocket_delete_source)
    domain_data[DATA_MANAGEMENT_REGISTERED] = True
