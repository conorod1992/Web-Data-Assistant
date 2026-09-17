"""Web Data Assistant integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import PLATFORMS
from .coordinator import WebDataCoordinator
from .websocket import async_register_websocket_commands

type WebDataAssistantConfigEntry = ConfigEntry[WebDataCoordinator]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up integration-wide Web Data Assistant functionality."""
    async_register_websocket_commands(hass)
    return True


async def async_setup_entry(
    hass: HomeAssistant,
    entry: WebDataAssistantConfigEntry,
) -> bool:
    """Set up Web Data Assistant from a config entry."""
    coordinator = WebDataCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(
    hass: HomeAssistant,
    entry: WebDataAssistantConfigEntry,
) -> bool:
    """Unload a Web Data Assistant config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
