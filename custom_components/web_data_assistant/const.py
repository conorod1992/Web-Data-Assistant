"""Constants for Web Data Assistant."""

from __future__ import annotations

DOMAIN = "web_data_assistant"
PLATFORMS = ["sensor"]

CONF_SOURCE_TYPE = "source_type"
CONF_SOURCE_NAME = "source_name"
CONF_URL = "url"
CONF_METHOD = "method"
CONF_HEADERS = "headers"
CONF_PAYLOAD = "payload"
CONF_VERIFY_SSL = "verify_ssl"
CONF_SCAN_INTERVAL = "scan_interval"
CONF_FAILURE_MODE = "failure_mode"
CONF_MAX_STALE_MINUTES = "max_stale_minutes"
CONF_LONG_TEXT_POLICY = "long_text_policy"
CONF_ENTITIES = "entities"
CONF_PATH = "path"
CONF_ATTRIBUTES = "attributes"
CONF_SELECTOR = "selector"
CONF_INDEX = "index"
CONF_ATTRIBUTE = "attribute"
CONF_UNIT = "unit"
CONF_DEVICE_CLASS = "device_class"
CONF_STATE_CLASS = "state_class"
CONF_VALUE_TYPE = "value_type"
CONF_SEARCH_TEXT = "search_text"

SOURCE_JSON = "json"
SOURCE_SCRAPE = "scrape"

METHOD_GET = "GET"
METHOD_POST = "POST"

FAILURE_UNAVAILABLE = "unavailable"
FAILURE_KEEP_LAST = "keep_last"

LONG_TEXT_TRUNCATE = "truncate"
LONG_TEXT_ATTRIBUTE_ONLY = "attribute_only"
LONG_TEXT_UNAVAILABLE = "unavailable"
DEFAULT_LONG_TEXT_POLICY = LONG_TEXT_TRUNCATE

VALUE_TEXT = "text"
VALUE_NUMBER = "number"
VALUE_BOOLEAN = "boolean"
VALUE_JSON = "json"

DEFAULT_SCAN_INTERVAL_MINUTES = 5
DEFAULT_REQUEST_TIMEOUT = 20
DEFAULT_VERIFY_SSL = True
DEFAULT_FAILURE_MODE = FAILURE_UNAVAILABLE

MAX_RESPONSE_BYTES = 2_000_000
MAX_JSON_DISCOVERY_VALUES = 250
MAX_HTML_MATCHES = 50
MAX_PREVIEW_LENGTH = 180

DATA_FRONTEND_REGISTERED = "frontend_registered"
DATA_WEBSOCKET_REGISTERED = "websocket_registered"
DATA_MANAGEMENT_REGISTERED = "management_registered"
