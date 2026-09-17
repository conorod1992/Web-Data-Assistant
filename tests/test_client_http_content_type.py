"""Additional real HTTP compatibility tests for Web Data Assistant."""

from __future__ import annotations

from aiohttp import web
from homeassistant.core import HomeAssistant

from custom_components.web_data_assistant.client import WebDataClient


async def test_client_parses_json_even_when_content_type_is_text_plain(
    hass: HomeAssistant,
    aiohttp_server,
    socket_enabled,
) -> None:
    """Parse valid JSON when a source mislabels its MIME type as plain text."""
    app = web.Application()

    async def mislabeled(_request: web.Request) -> web.Response:
        return web.Response(
            text='{"temperature":14.6,"condition":"Cloudy"}',
            content_type="text/plain",
        )

    app.router.add_get("/mislabeled", mislabeled)
    server = await aiohttp_server(app)

    response = await WebDataClient(hass).async_fetch(
        str(server.make_url("/mislabeled")),
        parse_json=True,
    )

    assert response.status == 200
    assert response.json_data == {"temperature": 14.6, "condition": "Cloudy"}
    assert response.content_type.startswith("text/plain")
