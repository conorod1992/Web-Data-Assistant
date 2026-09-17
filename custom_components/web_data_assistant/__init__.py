"""Web Data Assistant integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, PLATFORMS
from .coordinator import WebDataCoordinator
from .frontend import async_register_frontend
from .management import async_register_management_commands
from .websocket import async_register_websocket_commands

type WebDataAssistantConfigEntry = ConfigEntry[WebDataCoordinator]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up integration-wide Web Data Assistant functionality."""
    async_register_websocket_commands(hass)
    async_register_management_commands(hass)
    await async_register_frontend(hass)
    return True


async def async_setup_entry(
    hass: HomeAssistant,
    entry: WebDataAssistantConfigEntry,
) -> bool:
    """Set up Web Data Assistant from a config entry."""
    coordinator = WebDataCoordinator(hass, entry)

    # Sources are validated when they are created. A later outage should therefore
    # load the config entry and its entities rather than hide them behind setup-retry.
    # Entity availability (or restored-value retention) is the user-configured policy.
    await coordinator.async_refresh()

    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(
    hass: HomeAssistant,
    entry: WebDataAssistantConfigEntry,
) -> bool:
    """Unload a Web Data Assistant config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
