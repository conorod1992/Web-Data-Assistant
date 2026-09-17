"""Web Data Assistant integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import CONF_FAILURE_MODE, FAILURE_KEEP_LAST, PLATFORMS
from .coordinator import WebDataCoordinator
from .frontend import async_register_frontend
from .management import async_register_management_commands
from .websocket import async_register_websocket_commands

type WebDataAssistantConfigEntry = ConfigEntry[WebDataCoordinator]


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

    failure_mode = entry.options.get(
        CONF_FAILURE_MODE,
        entry.data.get(CONF_FAILURE_MODE),
    )
    if failure_mode == FAILURE_KEEP_LAST:
        # A retained-value source must still load its entities when the remote source
        # is offline during Home Assistant startup. The sensors can then restore the
        # previous state and replace it after the first successful coordinator update.
        await coordinator.async_refresh()
    else:
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
