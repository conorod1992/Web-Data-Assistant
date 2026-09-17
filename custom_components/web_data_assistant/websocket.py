"""WebSocket API used by the Web Data Assistant guided frontend."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .client import WebDataClient, WebDataError
from .const import (
    CONF_ATTRIBUTE,
    CONF_DEVICE_CLASS,
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_HEADERS,
    CONF_INDEX,
    CONF_MAX_STALE_MINUTES,
    CONF_METHOD,
    CONF_PATH,
    CONF_PAYLOAD,
    CONF_SCAN_INTERVAL,
    CONF_SEARCH_TEXT,
    CONF_SELECTOR,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_STATE_CLASS,
    CONF_UNIT,
    CONF_URL,
    CONF_VALUE_TYPE,
    CONF_VERIFY_SSL,
    DATA_WEBSOCKET_REGISTERED,
    DEFAULT_FAILURE_MODE,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    DEFAULT_VERIFY_SSL,
    DOMAIN,
    FAILURE_KEEP_LAST,
    FAILURE_UNAVAILABLE,
    MAX_RESPONSE_BYTES,
    METHOD_GET,
    METHOD_POST,
    SOURCE_JSON,
    SOURCE_SCRAPE,
    VALUE_BOOLEAN,
    VALUE_JSON,
    VALUE_NUMBER,
    VALUE_TEXT,
)
from .extraction import (
    discover_json_candidates,
    extract_html_entities,
    find_html_text_matches,
    resolve_json_pointer,
)
from .models import WebDataEntityConfig
from .preview import build_html_preview


def _http_url(value: str) -> str:
    """Validate a user-supplied HTTP(S) URL."""
    value = value.strip()
    parts = urlsplit(value)
    if parts.scheme.casefold() not in {"http", "https"} or not parts.netloc:
        raise vol.Invalid("A valid HTTP or HTTPS URL is required")
    return value


def _non_empty_text(value: str) -> str:
    """Return stripped text and reject empty input."""
    value = value.strip()
    if not value:
        raise vol.Invalid("Value cannot be empty")
    return value


_COMMON_FIELDS: dict[Any, Any] = {
    vol.Required(CONF_URL): _http_url,
    vol.Optional(CONF_METHOD, default=METHOD_GET): vol.In([METHOD_GET, METHOD_POST]),
    vol.Optional(CONF_HEADERS): {str: str},
    vol.Optional(CONF_PAYLOAD): vol.All(str, vol.Length(max=MAX_RESPONSE_BYTES)),
    vol.Optional(CONF_VERIFY_SSL, default=DEFAULT_VERIFY_SSL): bool,
}

_ENTITY_SCHEMA = vol.Schema(
    {
        vol.Required("key"): vol.All(str, _non_empty_text, vol.Length(max=150)),
        vol.Required("name"): vol.All(str, _non_empty_text, vol.Length(max=150)),
        vol.Required(CONF_VALUE_TYPE, default=VALUE_TEXT): vol.In(
            [VALUE_TEXT, VALUE_NUMBER, VALUE_BOOLEAN, VALUE_JSON]
        ),
        vol.Optional(CONF_PATH): vol.All(str, vol.Length(max=2000)),
        vol.Optional(CONF_SELECTOR): vol.All(str, vol.Length(min=1, max=2000)),
        vol.Optional(CONF_INDEX, default=0): vol.All(vol.Coerce(int), vol.Range(min=0)),
        vol.Optional(CONF_ATTRIBUTE): vol.All(str, vol.Length(min=1, max=200)),
        vol.Optional(CONF_UNIT): vol.All(str, vol.Length(max=100)),
        vol.Optional(CONF_DEVICE_CLASS): vol.All(str, vol.Length(max=100)),
        vol.Optional(CONF_STATE_CLASS): vol.All(str, vol.Length(max=100)),
    },
    extra=vol.PREVENT_EXTRA,
)


def _fetch_kwargs(msg: dict[str, Any]) -> dict[str, Any]:
    """Return common client keyword arguments from a WebSocket message."""
    return {
        "method": msg.get(CONF_METHOD, METHOD_GET),
        "headers": msg.get(CONF_HEADERS),
        "payload": msg.get(CONF_PAYLOAD),
        "verify_ssl": msg.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
    }


def _validate_entity_definitions(source_type: str, entities: list[dict[str, Any]]) -> None:
    """Validate relationships that cannot be expressed per entity in the schema."""
    keys = [str(entity["key"]) for entity in entities]
    if len(set(keys)) != len(keys):
        raise ValueError("Each sensor in a source must have a unique key")

    for entity in entities:
        if source_type == SOURCE_JSON:
            if CONF_PATH not in entity:
                raise ValueError("A selected JSON value is missing its path")
            if CONF_SELECTOR in entity:
                raise ValueError("JSON sensors cannot contain an HTML selector")
        else:
            if not entity.get(CONF_SELECTOR):
                raise ValueError("A selected page value is missing its selector")
            if CONF_PATH in entity:
                raise ValueError("Web page sensors cannot contain a JSON path")
            if entity.get(CONF_VALUE_TYPE) == VALUE_JSON:
                raise ValueError("Web page sensors cannot use the full JSON value type")


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
            **_fetch_kwargs(msg),
            parse_json=True,
        )
    except WebDataError as err:
        connection.send_error(msg["id"], "fetch_failed", str(err))
        return

    discovered, truncated = discover_json_candidates(response.json_data)
    candidates = [
        {
            "path": candidate.path,
            "display_path": candidate.display_path,
            "preview": candidate.preview,
            "value_type": type(candidate.value).__name__,
        }
        for candidate in discovered
    ]
    connection.send_result(
        msg["id"],
        {
            "status": response.status,
            "content_type": response.content_type,
            "values": candidates,
            "truncated": truncated,
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
            **_fetch_kwargs(msg),
            parse_json=False,
        )
        preview_html, elements = await hass.async_add_executor_job(
            build_html_preview,
            response.text,
            msg[CONF_URL],
        )
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
        vol.Required("type"): f"{DOMAIN}/search_html",
        vol.Required(CONF_SEARCH_TEXT): vol.All(
            str, _non_empty_text, vol.Length(max=500)
        ),
        **_COMMON_FIELDS,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_search_html(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Find the smallest page elements containing user-entered visible text."""
    client = WebDataClient(hass)
    try:
        response = await client.async_fetch(
            msg[CONF_URL],
            **_fetch_kwargs(msg),
            parse_json=False,
        )
        matches = await hass.async_add_executor_job(
            find_html_text_matches,
            response.text,
            msg[CONF_SEARCH_TEXT],
        )
    except WebDataError as err:
        connection.send_error(msg["id"], "fetch_failed", str(err))
        return
    except (TypeError, ValueError) as err:
        connection.send_error(msg["id"], "search_failed", str(err))
        return

    connection.send_result(
        msg["id"],
        {
            "matches": [
                {
                    "selector": match.selector,
                    "index": match.index,
                    "text": match.text,
                    "context": match.context,
                    "tag": match.tag,
                }
                for match in matches
            ]
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/create_source",
        vol.Required(CONF_SOURCE_NAME): vol.All(
            str, _non_empty_text, vol.Length(max=100)
        ),
        vol.Required(CONF_SOURCE_TYPE): vol.In([SOURCE_JSON, SOURCE_SCRAPE]),
        vol.Required(CONF_ENTITIES): vol.All(
            [_ENTITY_SCHEMA], vol.Length(min=1, max=100)
        ),
        vol.Optional(CONF_SCAN_INTERVAL, default=DEFAULT_SCAN_INTERVAL_MINUTES): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=1440)
        ),
        vol.Optional(CONF_FAILURE_MODE, default=DEFAULT_FAILURE_MODE): vol.In(
            [FAILURE_UNAVAILABLE, FAILURE_KEEP_LAST]
        ),
        vol.Optional(CONF_MAX_STALE_MINUTES): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=525600)
        ),
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

    try:
        _validate_entity_definitions(source_type, entities)
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_entities", str(err))
        return

    client = WebDataClient(hass)
    try:
        response = await client.async_fetch(
            msg[CONF_URL],
            **_fetch_kwargs(msg),
            parse_json=source_type == SOURCE_JSON,
        )
        if source_type == SOURCE_JSON:
            for entity in entities:
                resolve_json_pointer(response.json_data, str(entity[CONF_PATH]))
        else:
            entity_configs = [WebDataEntityConfig.from_dict(entity) for entity in entities]
            validation_result = await hass.async_add_executor_job(
                extract_html_entities,
                response.text,
                entity_configs,
            )
            if validation_result.extraction_errors:
                first_key, first_error = next(
                    iter(validation_result.extraction_errors.items())
                )
                raise ValueError(f"{first_key}: {first_error}")
    except (WebDataError, KeyError, TypeError, ValueError) as err:
        connection.send_error(msg["id"], "validation_failed", str(err))
        return

    data: dict[str, Any] = {
        "_panel_create": True,
        CONF_SOURCE_NAME: msg[CONF_SOURCE_NAME],
        CONF_SOURCE_TYPE: source_type,
        CONF_URL: msg[CONF_URL],
        CONF_METHOD: msg.get(CONF_METHOD, METHOD_GET),
        CONF_HEADERS: msg.get(CONF_HEADERS, {}),
        CONF_VERIFY_SSL: msg.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
        CONF_SCAN_INTERVAL: msg.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL_MINUTES),
        CONF_FAILURE_MODE: msg.get(CONF_FAILURE_MODE, DEFAULT_FAILURE_MODE),
        CONF_ENTITIES: entities,
    }
    if payload := msg.get(CONF_PAYLOAD):
        data[CONF_PAYLOAD] = payload
    if stale := msg.get(CONF_MAX_STALE_MINUTES):
        data[CONF_MAX_STALE_MINUTES] = stale

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
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_WEBSOCKET_REGISTERED):
        return

    websocket_api.async_register_command(hass, websocket_preview_json)
    websocket_api.async_register_command(hass, websocket_preview_html)
    websocket_api.async_register_command(hass, websocket_search_html)
    websocket_api.async_register_command(hass, websocket_create_source)
    domain_data[DATA_WEBSOCKET_REGISTERED] = True
