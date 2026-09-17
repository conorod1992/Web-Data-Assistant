"""Sensor platform for Web Data Assistant."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, override

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import MAX_LENGTH_STATE_STATE, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from . import WebDataAssistantConfigEntry
from .const import (
    CONF_FAILURE_MODE,
    CONF_MAX_STALE_MINUTES,
    DOMAIN,
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


def _bounded_state(value: Any) -> Any:
    """Keep text states within Home Assistant's 255-character state limit."""
    if not isinstance(value, str) or len(value) <= MAX_LENGTH_STATE_STATE:
        return value
    return f"{value[: MAX_LENGTH_STATE_STATE - 1]}…"


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


class WebDataSensor(
    CoordinatorEntity[WebDataCoordinator],
    RestoreEntity,
    SensorEntity,
):
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
        self._restored_value: Any | None = None
        self._has_restored_value = False
        self._restored_last_successful_update: datetime | None = None
        self._attr_name = None if config.name == entry.title else config.name
        self._attr_unique_id = f"{entry.entry_id}_{config.key}"
        self._attr_native_unit_of_measurement = config.unit
        self._attr_device_info = DeviceInfo(
            entry_type=DeviceEntryType.SERVICE,
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="Web Data Assistant",
            model="Web data source",
        )

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

    def _live_value_available(self) -> bool:
        """Return whether the coordinator currently retains this entity's value."""
        return (
            self.coordinator.data is not None
            and self._config.key in self.coordinator.data.values
        )

    def _effective_raw_value(self) -> Any | None:
        """Return live retained data first, then a restored startup value."""
        if self._live_value_available():
            return self.coordinator.value_for(self._config.key)
        if self._has_restored_value:
            return self._restored_value
        return None

    def _effective_last_successful_update(self) -> datetime | None:
        """Return the timestamp associated with the retained value."""
        if self._live_value_available():
            return self.coordinator.last_successful_update
        return self._restored_last_successful_update

    @override
    async def async_added_to_hass(self) -> None:
        """Restore a retained value if startup could not reach the source."""
        await super().async_added_to_hass()

        failure_mode = self._entry.options.get(
            CONF_FAILURE_MODE,
            self._entry.data.get(CONF_FAILURE_MODE, FAILURE_UNAVAILABLE),
        )
        if failure_mode != FAILURE_KEEP_LAST or self._live_value_available():
            return

        last_state = await self.async_get_last_state()
        if last_state is None or last_state.state in {STATE_UNKNOWN, STATE_UNAVAILABLE}:
            return

        if self._config.value_type == VALUE_JSON:
            if "data" not in last_state.attributes:
                return
            self._restored_value = last_state.attributes["data"]
        elif "full_value" in last_state.attributes:
            self._restored_value = last_state.attributes["full_value"]
        else:
            self._restored_value = last_state.state
        self._has_restored_value = True

        restored_timestamp = last_state.attributes.get("last_successful_update")
        if isinstance(restored_timestamp, str):
            self._restored_last_successful_update = dt_util.parse_datetime(
                restored_timestamp
            )
        if self._restored_last_successful_update is None:
            self._restored_last_successful_update = last_state.last_updated

    @property
    def native_value(self) -> Any:
        """Return the latest extracted or restored state."""
        value = _coerce_value(
            self._effective_raw_value(),
            self._config.value_type,
        )
        return _bounded_state(value)

    @property
    def available(self) -> bool:
        """Apply the configured source-failure behaviour."""
        if self.coordinator.extraction_error_for(self._config.key):
            return False

        if self.coordinator.last_update_success:
            return self._live_value_available()

        failure_mode = self._entry.options.get(
            CONF_FAILURE_MODE,
            self._entry.data.get(CONF_FAILURE_MODE, FAILURE_UNAVAILABLE),
        )
        if failure_mode != FAILURE_KEEP_LAST:
            return False
        if not self._live_value_available() and not self._has_restored_value:
            return False

        max_stale = self._entry.options.get(
            CONF_MAX_STALE_MINUTES,
            self._entry.data.get(CONF_MAX_STALE_MINUTES),
        )
        if not max_stale:
            return True

        last_successful_update = self._effective_last_successful_update()
        if last_successful_update is None:
            return False

        age = dt_util.utcnow() - last_successful_update
        return age <= timedelta(minutes=int(max_stale))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose source health and values that do not fit safely in state."""
        attributes: dict[str, Any] = {
            "source_available": self.coordinator.last_update_success,
        }
        raw_value = self._effective_raw_value()
        if self._config.value_type == VALUE_JSON:
            attributes["data"] = raw_value
        elif isinstance(raw_value, str) and len(raw_value) > MAX_LENGTH_STATE_STATE:
            attributes["full_value"] = raw_value
            attributes["state_truncated"] = True

        last_successful_update = self._effective_last_successful_update()
        if last_successful_update is not None:
            attributes["last_successful_update"] = last_successful_update.isoformat()
        if self.coordinator.last_source_error:
            attributes["source_error"] = self.coordinator.last_source_error
        if extraction_error := self.coordinator.extraction_error_for(self._config.key):
            attributes["extraction_error"] = extraction_error
        return attributes
