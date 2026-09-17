"""Frontend registration for Web Data Assistant."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DATA_FRONTEND_REGISTERED, DOMAIN

FRONTEND_DIR = Path(__file__).parent / "frontend"
FRONTEND_URL = f"/{DOMAIN}/frontend"
PANEL_URL_PATH = "web-data-assistant"
PANEL_ELEMENT = "web-data-assistant-panel"


async def async_register_frontend(hass: HomeAssistant) -> None:
    """Serve and register the Web Data Assistant management panel once."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(DATA_FRONTEND_REGISTERED):
        return

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                FRONTEND_URL,
                str(FRONTEND_DIR),
                cache_headers=False,
            )
        ]
    )

    if PANEL_URL_PATH not in hass.data.get("frontend_panels", {}):
        frontend.async_register_built_in_panel(
            hass,
            component_name="custom",
            sidebar_title="Web Data Assistant",
            sidebar_icon="mdi:web-box",
            frontend_url_path=PANEL_URL_PATH,
            config={
                "_panel_custom": {
                    "name": PANEL_ELEMENT,
                    "embed_iframe": False,
                    "trust_external": False,
                    "js_url": f"{FRONTEND_URL}/web-data-assistant-panel.js",
                }
            },
            require_admin=True,
        )

    domain_data[DATA_FRONTEND_REGISTERED] = True
