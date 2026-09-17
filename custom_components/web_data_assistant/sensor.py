"""Sensor platform for Web Data Assistant."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, override

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import MAX_LENGTH_STATE_STATE, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_point_in_utc_time
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from . import WebDataAssistantConfigEntry
from .const import (
    CONF_FAILURE_MODE,
    CONF_LONG_TEXT_POLICY,
    CONF_MAX_STALE_MINUTES,
    DEFAULT_LONG_TEXT_POLICY,
    DOMAIN,
    FAILURE_KEEP_LAST,
    FAILURE_UNAVAILABLE,
    LONG_TEXT_ATTRIBUTE_ONLY,
    LONG_TEXT_TRUNCATE,
    LONG_TEXT_UNAVAILABLE,
    VALUE_BOOLEAN,
    VALUE_JSON,
    VALUE_NUMBER,
)
from .coordinator import WebDataCoordinator
from .models import WebDataEntityConfig

_RESERVED_ATTRIBUTES = {
    "source_available",
    "last_successful_update",
    "source_error",
    "extraction_error",
    "full_value",
    "state_truncated",
    "data",
}


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
            return "true" if value else "false"
        normalised = str(value).strip().casefold()
        if normalised in {"1", "true", "yes", "on", "open", "active"}:
            return "true"
        if normalised in {"0", "false", "no", "off", "closed", "inactive"}:
            return "false"
        return normalised

    if isinstance(value, (dict, list)):
        return str(value)
    return value


def _truncate_state(value: Any) -> Any:
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
    """One value or aggregate JSON object extracted from a web source."""

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
        self._restored_attributes: dict[str, Any] = {}
        self._has_restored_value = False
        self._restored_last_successful_update: datetime | None = None
        self._cancel_stale_timer: Callable[[], None] | None = None
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

    def _effective_json_attributes(self) -> dict[str, Any]:
        """Return live aggregate JSON attributes or restored startup attributes."""
        if self._live_value_available():
            return self.coordinator.attributes_for(self._config.key)
        return self._restored_attributes

    def _effective_last_successful_update(self) -> datetime | None:
        """Return the timestamp associated with the retained value."""
        if self._live_value_available():
            return self.coordinator.last_successful_update
        return self._restored_last_successful_update

    def _failure_mode(self) -> str:
        """Return the effective source-failure mode."""
        return self._entry.options.get(
            CONF_FAILURE_MODE,
            self._entry.data.get(CONF_FAILURE_MODE, FAILURE_UNAVAILABLE),
        )

    def _long_text_policy(self) -> str:
        """Return the effective long-text policy for this entity."""
        return self._config.long_text_policy or self._entry.options.get(
            CONF_LONG_TEXT_POLICY,
            self._entry.data.get(CONF_LONG_TEXT_POLICY, DEFAULT_LONG_TEXT_POLICY),
        )

    def _max_stale_minutes(self) -> int | None:
        """Return the configured retained-value age limit, if any."""
        value = self._entry.options.get(
            CONF_MAX_STALE_MINUTES,
            self._entry.data.get(CONF_MAX_STALE_MINUTES),
        )
        return int(value) if value else None

    def _coerced_value(self) -> Any:
        """Return the entity's coerced state value before long-text handling."""
        return _coerce_value(self._effective_raw_value(), self._config.value_type)

    def _is_overlong_text(self) -> bool:
        """Return whether the current state value exceeds HA's state limit."""
        value = self._coerced_value()
        return isinstance(value, str) and len(value) > MAX_LENGTH_STATE_STATE

    @callback
    def _cancel_stale_expiry(self) -> None:
        """Cancel a previously scheduled stale deadline."""
        if self._cancel_stale_timer is not None:
            self._cancel_stale_timer()
            self._cancel_stale_timer = None

    @callback
    def _schedule_stale_expiry(self) -> None:
        """Schedule a state write at the exact retained-value stale deadline."""
        self._cancel_stale_expiry()

        if self.coordinator.last_update_success:
            return
        if self._failure_mode() != FAILURE_KEEP_LAST:
            return
        max_stale = self._max_stale_minutes()
        last_success = self._effective_last_successful_update()
        if max_stale is None or last_success is None:
            return
        if not self._live_value_available() and not self._has_restored_value:
            return

        expires = last_success + timedelta(minutes=max_stale)
        if expires <= dt_util.utcnow():
            return
        self._cancel_stale_timer = async_track_point_in_utc_time(
            self.hass,
            self._handle_stale_deadline,
            expires,
        )

    @callback
    def _handle_stale_deadline(self, now: datetime) -> None:
        """Write state when a retained value crosses its age limit."""
        self._cancel_stale_timer = None
        self.async_write_ha_state()

    @override
    @callback
    def _handle_coordinator_update(self) -> None:
        """Reschedule stale handling whenever the source refreshes."""
        self._schedule_stale_expiry()
        super()._handle_coordinator_update()

    @override
    async def async_added_to_hass(self) -> None:
        """Restore retained state and aggregate attributes after an offline restart."""
        await super().async_added_to_hass()
        self.async_on_remove(self._cancel_stale_expiry)

        if self._failure_mode() != FAILURE_KEEP_LAST or self._live_value_available():
            self._schedule_stale_expiry()
            return

        last_state = await self.async_get_last_state()
        if last_state is None or last_state.state in {STATE_UNKNOWN, STATE_UNAVAILABLE}:
            self._schedule_stale_expiry()
            return

        if self._config.value_type == VALUE_JSON:
            if "data" not in last_state.attributes:
                self._schedule_stale_expiry()
                return
            self._restored_value = last_state.attributes["data"]
        elif "full_value" in last_state.attributes:
            self._restored_value = last_state.attributes["full_value"]
        else:
            self._restored_value = last_state.state
        self._has_restored_value = True

        if self._config.attributes:
            self._restored_attributes = {
                name: last_state.attributes[name]
                for name in self._config.attributes
                if name in last_state.attributes and name not in _RESERVED_ATTRIBUTES
            }

        restored_timestamp = last_state.attributes.get("last_successful_update")
        if isinstance(restored_timestamp, str):
            self._restored_last_successful_update = dt_util.parse_datetime(
                restored_timestamp
            )
        if self._restored_last_successful_update is None:
            self._restored_last_successful_update = last_state.last_updated
        self._schedule_stale_expiry()

    @property
    def native_value(self) -> Any:
        """Return the latest state while applying the configured long-text policy."""
        value = self._coerced_value()
        if not isinstance(value, str) or len(value) <= MAX_LENGTH_STATE_STATE:
            return value

        policy = self._long_text_policy()
        if policy == LONG_TEXT_ATTRIBUTE_ONLY:
            return "Loaded"
        if policy == LONG_TEXT_UNAVAILABLE:
            return value[:MAX_LENGTH_STATE_STATE]
        return _truncate_state(value)

    @property
    def available(self) -> bool:
        """Apply extraction, long-text and source-failure behaviour."""
        if self.coordinator.extraction_error_for(self._config.key):
            return False
        if self._is_overlong_text() and self._long_text_policy() == LONG_TEXT_UNAVAILABLE:
            return False

        if self.coordinator.last_update_success:
            return self._live_value_available()

        if self._failure_mode() != FAILURE_KEEP_LAST:
            return False
        if not self._live_value_available() and not self._has_restored_value:
            return False

        max_stale = self._max_stale_minutes()
        if max_stale is None:
            return True

        last_successful_update = self._effective_last_successful_update()
        if last_successful_update is None:
            return False

        age = dt_util.utcnow() - last_successful_update
        return age <= timedelta(minutes=max_stale)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose selected JSON attributes, source health and full long text."""
        attributes: dict[str, Any] = dict(self._effective_json_attributes())
        attributes["source_available"] = self.coordinator.last_update_success

        raw_value = self._effective_raw_value()
        if self._config.value_type == VALUE_JSON:
            attributes["data"] = raw_value
        elif self._is_overlong_text():
            attributes["full_value"] = raw_value
            attributes["state_truncated"] = self._long_text_policy() == LONG_TEXT_TRUNCATE

        last_successful_update = self._effective_last_successful_update()
        if last_successful_update is not None:
            attributes["last_successful_update"] = last_successful_update.isoformat()
        if self.coordinator.last_source_error:
            attributes["source_error"] = self.coordinator.last_source_error
        if extraction_error := self.coordinator.extraction_error_for(self._config.key):
            attributes["extraction_error"] = extraction_error
        return attributes
