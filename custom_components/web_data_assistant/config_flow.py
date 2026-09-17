"""Config flow for Web Data Assistant."""

from __future__ import annotations

import json
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.selector import (
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)
from homeassistant.util import slugify

from .client import WebDataClient, WebDataError
from .const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_HEADERS,
    CONF_MAX_STALE_MINUTES,
    CONF_METHOD,
    CONF_PAYLOAD,
    CONF_SCAN_INTERVAL,
    CONF_SEARCH_TEXT,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VERIFY_SSL,
    DEFAULT_FAILURE_MODE,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    DEFAULT_VERIFY_SSL,
    DOMAIN,
    FAILURE_KEEP_LAST,
    FAILURE_UNAVAILABLE,
    METHOD_GET,
    METHOD_POST,
    SOURCE_JSON,
    SOURCE_SCRAPE,
    VALUE_BOOLEAN,
    VALUE_NUMBER,
    VALUE_TEXT,
)
from .extraction import find_html_text_matches, iter_json_candidates
from .models import HtmlMatch, JsonCandidate, WebDataEntityConfig


class WebDataAssistantConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Web Data Assistant."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialise flow state."""
        self._source: dict[str, Any] = {}
        self._response_text: str | None = None
        self._json_candidates: list[JsonCandidate] = []
        self._html_matches: list[HtmlMatch] = []
        self._search_text: str = ""

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Choose the kind of data source to create."""
        if user_input is not None:
            self._source.update(user_input)
            return await self.async_step_source()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_SOURCE_NAME): str,
                    vol.Required(CONF_SOURCE_TYPE, default=SOURCE_JSON): SelectSelector(
                        SelectSelectorConfig(
                            options=[SOURCE_JSON, SOURCE_SCRAPE],
                            translation_key="source_type",
                        )
                    ),
                }
            ),
        )

    async def async_step_source(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Collect connection details and test the source."""
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                headers = self._parse_headers(user_input.get(CONF_HEADERS, ""))
            except ValueError:
                errors[CONF_HEADERS] = "invalid_headers"
            else:
                self._source.update(user_input)
                self._source[CONF_HEADERS] = headers
                if not self._source.get(CONF_PAYLOAD):
                    self._source.pop(CONF_PAYLOAD, None)

                client = WebDataClient(self.hass)
                try:
                    response = await client.async_fetch(
                        self._source[CONF_URL],
                        method=self._source.get(CONF_METHOD, METHOD_GET),
                        headers=headers,
                        payload=self._source.get(CONF_PAYLOAD),
                        verify_ssl=self._source.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
                        parse_json=self._source[CONF_SOURCE_TYPE] == SOURCE_JSON,
                    )
                except WebDataError:
                    errors["base"] = "cannot_connect"
                else:
                    self._response_text = response.text
                    if self._source[CONF_SOURCE_TYPE] == SOURCE_JSON:
                        self._json_candidates = list(iter_json_candidates(response.json_data))
                        if not self._json_candidates:
                            errors["base"] = "no_json_values"
                        else:
                            return await self.async_step_json_values()
                    else:
                        return await self.async_step_scrape_search()

        return self.async_show_form(
            step_id="source",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_URL): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.URL)
                    ),
                    vol.Required(CONF_METHOD, default=METHOD_GET): SelectSelector(
                        SelectSelectorConfig(options=[METHOD_GET, METHOD_POST])
                    ),
                    vol.Optional(CONF_HEADERS): TextSelector(
                        TextSelectorConfig(multiline=True)
                    ),
                    vol.Optional(CONF_PAYLOAD): TextSelector(
                        TextSelectorConfig(multiline=True)
                    ),
                    vol.Required(CONF_VERIFY_SSL, default=DEFAULT_VERIFY_SSL): bool,
                }
            ),
            errors=errors,
        )

    async def async_step_json_values(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Let the user select scalar values discovered in a JSON response."""
        errors: dict[str, str] = {}
        candidate_map = {candidate.path: candidate for candidate in self._json_candidates}

        if user_input is not None:
            selected: list[str] = user_input.get("selected_values", [])
            if not selected:
                errors["base"] = "select_value"
            else:
                entities: list[dict[str, Any]] = []
                for path in selected:
                    candidate = candidate_map.get(path)
                    if candidate is None:
                        continue
                    name = self._friendly_json_name(candidate.display_path)
                    entities.append(
                        WebDataEntityConfig(
                            key=self._unique_key(path, entities),
                            name=name,
                            path=path,
                            value_type=self._infer_value_type(candidate.value),
                        ).as_dict()
                    )
                if entities:
                    self._source[CONF_ENTITIES] = entities
                    return await self.async_step_behaviour()
                errors["base"] = "select_value"

        options = [
            SelectOptionDict(
                value=candidate.path,
                label=f"{candidate.display_path} — {candidate.preview}",
            )
            for candidate in self._json_candidates
        ]
        return self.async_show_form(
            step_id="json_values",
            data_schema=vol.Schema(
                {
                    vol.Required("selected_values"): SelectSelector(
                        SelectSelectorConfig(options=options, multiple=True)
                    )
                }
            ),
            errors=errors,
            description_placeholders={"count": str(len(options))},
        )

    async def async_step_scrape_search(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Find HTML elements using text the user can currently see."""
        errors: dict[str, str] = {}
        if user_input is not None:
            self._search_text = user_input[CONF_SEARCH_TEXT].strip()
            if self._response_text is None:
                return await self.async_step_source()
            self._html_matches = find_html_text_matches(
                self._response_text, self._search_text
            )
            if not self._html_matches:
                errors["base"] = "text_not_found"
            elif len(self._html_matches) == 1:
                return await self._async_use_html_match(self._html_matches[0])
            else:
                return await self.async_step_scrape_match()

        return self.async_show_form(
            step_id="scrape_search",
            data_schema=vol.Schema({vol.Required(CONF_SEARCH_TEXT): str}),
            errors=errors,
        )

    async def async_step_scrape_match(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Disambiguate multiple HTML text matches."""
        if user_input is not None:
            index = int(user_input["match"])
            if 0 <= index < len(self._html_matches):
                return await self._async_use_html_match(self._html_matches[index])

        options = [
            SelectOptionDict(
                value=str(index),
                label=f"{match.text} — {match.context}",
            )
            for index, match in enumerate(self._html_matches)
        ]
        return self.async_show_form(
            step_id="scrape_match",
            data_schema=vol.Schema(
                {
                    vol.Required("match"): SelectSelector(
                        SelectSelectorConfig(options=options)
                    )
                }
            ),
            description_placeholders={"count": str(len(options))},
        )

    async def _async_use_html_match(self, match: HtmlMatch) -> FlowResult:
        """Store a selected HTML match and continue the flow."""
        self._source[CONF_ENTITIES] = [
            WebDataEntityConfig(
                key=slugify(self._source[CONF_SOURCE_NAME]) or "web_value",
                name=self._source[CONF_SOURCE_NAME],
                selector=match.selector,
                index=match.index,
                value_type=VALUE_TEXT,
            ).as_dict()
        ]
        return await self.async_step_behaviour()

    async def async_step_behaviour(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Configure refresh and failure behaviour."""
        if user_input is not None:
            self._source.update(user_input)
            max_stale = self._source.get(CONF_MAX_STALE_MINUTES)
            if not max_stale:
                self._source.pop(CONF_MAX_STALE_MINUTES, None)
            return self.async_create_entry(
                title=self._source[CONF_SOURCE_NAME],
                data=self._source,
            )

        return self.async_show_form(
            step_id="behaviour",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_SCAN_INTERVAL,
                        default=DEFAULT_SCAN_INTERVAL_MINUTES,
                    ): vol.All(vol.Coerce(int), vol.Range(min=1, max=1440)),
                    vol.Required(
                        CONF_FAILURE_MODE,
                        default=DEFAULT_FAILURE_MODE,
                    ): SelectSelector(
                        SelectSelectorConfig(
                            options=[FAILURE_UNAVAILABLE, FAILURE_KEEP_LAST],
                            translation_key="failure_mode",
                        )
                    ),
                    vol.Optional(CONF_MAX_STALE_MINUTES): vol.All(
                        vol.Coerce(int), vol.Range(min=1, max=525600)
                    ),
                }
            ),
        )

    @staticmethod
    def _parse_headers(value: str | dict[str, str]) -> dict[str, str]:
        """Parse optional JSON headers entered in the flow."""
        if isinstance(value, dict):
            return {str(key): str(item) for key, item in value.items()}
        if not value or not value.strip():
            return {}
        parsed = json.loads(value)
        if not isinstance(parsed, dict):
            raise ValueError("Headers must be a JSON object")
        return {str(key): str(item) for key, item in parsed.items()}

    @staticmethod
    def _infer_value_type(value: Any) -> str:
        """Infer a basic entity value type from a JSON scalar."""
        if isinstance(value, bool):
            return VALUE_BOOLEAN
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return VALUE_NUMBER
        return VALUE_TEXT

    @staticmethod
    def _friendly_json_name(display_path: str) -> str:
        """Turn a discovered JSON path into a friendly entity name."""
        leaf = display_path.rsplit(".", 1)[-1]
        return leaf.replace("_", " ").replace("-", " ").strip().title() or "Web value"

    @staticmethod
    def _unique_key(path: str, entities: list[dict[str, Any]]) -> str:
        """Create a stable unique entity key for the selected path."""
        base = slugify(path.replace("/", "_")) or "root"
        existing = {str(entity["key"]) for entity in entities}
        if base not in existing:
            return base
        index = 2
        while f"{base}_{index}" in existing:
            index += 1
        return f"{base}_{index}"

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> "WebDataAssistantOptionsFlow":
        """Return the options flow."""
        return WebDataAssistantOptionsFlow()


class WebDataAssistantOptionsFlow(config_entries.OptionsFlowWithReload):
    """Manage refresh and failure settings after setup."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage Web Data Assistant options."""
        if user_input is not None:
            if not user_input.get(CONF_MAX_STALE_MINUTES):
                user_input.pop(CONF_MAX_STALE_MINUTES, None)
            return self.async_create_entry(data=user_input)

        defaults = {
            CONF_SCAN_INTERVAL: self.config_entry.options.get(
                CONF_SCAN_INTERVAL,
                self.config_entry.data.get(
                    CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL_MINUTES
                ),
            ),
            CONF_FAILURE_MODE: self.config_entry.options.get(
                CONF_FAILURE_MODE,
                self.config_entry.data.get(CONF_FAILURE_MODE, DEFAULT_FAILURE_MODE),
            ),
        }
        stale = self.config_entry.options.get(
            CONF_MAX_STALE_MINUTES,
            self.config_entry.data.get(CONF_MAX_STALE_MINUTES),
        )
        if stale:
            defaults[CONF_MAX_STALE_MINUTES] = stale

        schema = vol.Schema(
            {
                vol.Required(CONF_SCAN_INTERVAL): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=1440)
                ),
                vol.Required(CONF_FAILURE_MODE): SelectSelector(
                    SelectSelectorConfig(
                        options=[FAILURE_UNAVAILABLE, FAILURE_KEEP_LAST],
                        translation_key="failure_mode",
                    )
                ),
                vol.Optional(CONF_MAX_STALE_MINUTES): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=525600)
                ),
            }
        )
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(schema, defaults),
        )
