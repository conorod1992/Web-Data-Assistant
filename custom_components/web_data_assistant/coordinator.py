"""Shared source coordinator for Web Data Assistant."""

from __future__ import annotations

from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .client import WebDataClient, WebDataError
from .const import (
    CONF_ENTITIES,
    CONF_HEADERS,
    CONF_METHOD,
    CONF_PAYLOAD,
    CONF_SCAN_INTERVAL,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VERIFY_SSL,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    METHOD_GET,
    SOURCE_JSON,
)
from .extraction import extract_html_value, resolve_json_pointer
from .models import ExtractionResult, WebDataEntityConfig

_LOGGER = logging.getLogger(__name__)


class WebDataCoordinator(DataUpdateCoordinator[ExtractionResult]):
    """Fetch a source once and update all entities backed by that source."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialise a source coordinator."""
        self.entry = entry
        self.client = WebDataClient(hass)
        self.last_successful_update: datetime | None = None
        self.last_source_error: str | None = None

        interval_minutes = int(
            entry.options.get(
                CONF_SCAN_INTERVAL,
                entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL_MINUTES),
            )
        )
        super().__init__(
            hass,
            _LOGGER,
            name=f"{entry.title} source",
            update_interval=timedelta(minutes=max(1, interval_minutes)),
        )

    @property
    def entity_configs(self) -> list[WebDataEntityConfig]:
        """Return stored entity extraction definitions."""
        raw_entities = self.entry.data.get(CONF_ENTITIES, [])
        return [WebDataEntityConfig.from_dict(item) for item in raw_entities]

    async def _async_update_data(self) -> ExtractionResult:
        """Fetch and extract all configured values."""
        source_type = self.entry.data[CONF_SOURCE_TYPE]
        try:
            response = await self.client.async_fetch(
                self.entry.data[CONF_URL],
                method=self.entry.data.get(CONF_METHOD, METHOD_GET),
                headers=self.entry.data.get(CONF_HEADERS),
                payload=self.entry.data.get(CONF_PAYLOAD),
                verify_ssl=self.entry.data.get(CONF_VERIFY_SSL, True),
                parse_json=source_type == SOURCE_JSON,
            )
        except WebDataError as err:
            self.last_source_error = str(err)
            raise UpdateFailed(str(err)) from err

        result = ExtractionResult()
        for entity in self.entity_configs:
            try:
                if source_type == SOURCE_JSON:
                    if entity.path is None:
                        raise ValueError("No JSON path is configured")
                    value = resolve_json_pointer(response.json_data, entity.path)
                else:
                    if entity.selector is None:
                        raise ValueError("No HTML selector is configured")
                    value = extract_html_value(
                        response.text,
                        entity.selector,
                        entity.index,
                        entity.attribute,
                    )
                result.values[entity.key] = value
            except (KeyError, TypeError, ValueError) as err:
                result.extraction_errors[entity.key] = str(err)

        self.last_successful_update = dt_util.utcnow()
        self.last_source_error = None
        return result

    def value_for(self, key: str) -> Any | None:
        """Return the most recent successfully extracted value for an entity."""
        if self.data is None:
            return None
        return self.data.values.get(key)

    def extraction_error_for(self, key: str) -> str | None:
        """Return the latest extraction error for an entity."""
        if self.data is None:
            return None
        return self.data.extraction_errors.get(key)
