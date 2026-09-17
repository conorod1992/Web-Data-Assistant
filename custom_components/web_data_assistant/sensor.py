"""Sensor platform for Web Data Assistant."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from . import WebDataAssistantConfigEntry
from .const import (
    CONF_FAILURE_MODE,
    CONF_MAX_STALE_MINUTES,
    FAILURE_KEEP_LAST,
    FAILURE_UNAVAILABLE,
    VALUE_BOOLEAN,
    VALUE_JSON,
    VALUE_NUMBER,
)
from .coordinator import WebDataCoordinator
from .models import WebDataEntityConfig


def _coerce_value(value: Any, value_type: str) -> Any:
    """Coerce an extracted value into a Home Assistant-friendly state."""
    if value is None:
        return None

    if value_type == VALUE_JSON:
        return "Loaded"

    if value_type == VALUE_NUMBER:
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, (int, float)):
            return value
        try:
            number = Decimal(str(value).strip())
        except (InvalidOperation, ValueError):
            return value
        if number == number.to_integral_value():
            return int(number)
        return float(number)

    if value_type == VALUE_BOOLEAN:
        if isinstance(value, bool):
            return value
        normalised = str(value).strip().casefold()
        if normalised in {"1", "true", "yes", "on", "open", "active"}:
            return True
        if normalised in {"0", "false", "no", "off", "closed", "inactive"}:
            return False

    if isinstance(value, (dict, list)):
        return str(value)
    return value


async def async_setup_entry(
    hass: HomeAssistant,
    entry: WebDataAssistantConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up Web Data Assistant sensors for a config entry."""
    coordinator = entry.runtime_data
    async_add_entities(
        WebDataSensor(coordinator, entry, entity_config)
        for entity_config in coordinator.entity_configs
    )


class WebDataSensor(CoordinatorEntity[WebDataCoordinator], SensorEntity):
    """One value extracted from a Web Data Assistant source."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: WebDataCoordinator,
        entry: WebDataAssistantConfigEntry,
        config: WebDataEntityConfig,
    ) -> None:
        """Initialise the sensor."""
        super().__init__(coordinator)
        self._entry = entry
        self._config = config
        self._attr_name = config.name
        self._attr_unique_id = f"{entry.entry_id}_{config.key}"
        self._attr_native_unit_of_measurement = config.unit

        if config.device_class:
            try:
                self._attr_device_class = SensorDeviceClass(config.device_class)
            except ValueError:
                pass
        if config.state_class:
            try:
                self._attr_state_class = SensorStateClass(config.state_class)
            except ValueError:
                pass

    @property
    def native_value(self) -> Any:
        """Return the latest extracted state."""
        return _coerce_value(
            self.coordinator.value_for(self._config.key),
            self._config.value_type,
        )

    @property
    def available(self) -> bool:
        """Apply the configured source-failure behaviour."""
        if self.coordinator.extraction_error_for(self._config.key):
            return False

        if self.coordinator.last_update_success:
            return self._config.key in self.coordinator.data.values

        failure_mode = self._entry.options.get(
            CONF_FAILURE_MODE,
            self._entry.data.get(CONF_FAILURE_MODE, FAILURE_UNAVAILABLE),
        )
        if failure_mode != FAILURE_KEEP_LAST:
            return False
        if self.coordinator.data is None or self._config.key not in self.coordinator.data.values:
            return False

        max_stale = self._entry.options.get(
            CONF_MAX_STALE_MINUTES,
            self._entry.data.get(CONF_MAX_STALE_MINUTES),
        )
        if not max_stale:
            return True
        if self.coordinator.last_successful_update is None:
            return False

        age = dt_util.utcnow() - self.coordinator.last_successful_update
        return age <= timedelta(minutes=int(max_stale))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose source health and, for full JSON sensors, the payload itself."""
        attributes: dict[str, Any] = {
            "source_available": self.coordinator.last_update_success,
        }
        if self._config.value_type == VALUE_JSON:
            attributes["data"] = self.coordinator.value_for(self._config.key)
        if self.coordinator.last_successful_update is not None:
            attributes["last_successful_update"] = self.coordinator.last_successful_update.isoformat()
        if self.coordinator.last_source_error:
            attributes["source_error"] = self.coordinator.last_source_error
        if extraction_error := self.coordinator.extraction_error_for(self._config.key):
            attributes["extraction_error"] = extraction_error
        return attributes
