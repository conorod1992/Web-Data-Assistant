"""Real HTTP transport tests for Web Data Assistant."""

from __future__ import annotations

from aiohttp import web
from homeassistant.core import HomeAssistant
import pytest

from custom_components.web_data_assistant.client import (
    WebDataClient,
    WebDataConnectionError,
)


async def test_client_follows_http_redirects(
    hass: HomeAssistant,
    aiohttp_server,
    socket_enabled,
) -> None:
    """Follow a normal HTTP redirect and parse the final JSON response."""
    app = web.Application()

    async def redirect(_request: web.Request) -> web.StreamResponse:
        raise web.HTTPFound("/final")

    async def final(_request: web.Request) -> web.Response:
        return web.json_response({"value": 42})

    app.router.add_get("/start", redirect)
    app.router.add_get("/final", final)
    server = await aiohttp_server(app)

    response = await WebDataClient(hass).async_fetch(
        str(server.make_url("/start")),
        parse_json=True,
    )

    assert response.status == 200
    assert response.json_data == {"value": 42}
    assert "application/json" in response.content_type


async def test_client_reads_complete_chunked_response(
    hass: HomeAssistant,
    aiohttp_server,
    socket_enabled,
) -> None:
    """Assemble all chunks before decoding and parsing a response."""
    app = web.Application()

    async def chunked(request: web.Request) -> web.StreamResponse:
        response = web.StreamResponse(
            status=200,
            headers={"Content-Type": "application/json"},
        )
        await response.prepare(request)
        await response.write(b'{"temperature":')
        await response.write(b'14.6,"condition":')
        await response.write(b'"Cloudy"}')
        await response.write_eof()
        return response

    app.router.add_get("/chunked", chunked)
    server = await aiohttp_server(app)

    response = await WebDataClient(hass).async_fetch(
        str(server.make_url("/chunked")),
        parse_json=True,
    )

    assert response.status == 200
    assert response.json_data == {"temperature": 14.6, "condition": "Cloudy"}
    assert response.text == '{"temperature":14.6,"condition":"Cloudy"}'


async def test_client_classifies_http_503_as_source_failure(
    hass: HomeAssistant,
    aiohttp_server,
    socket_enabled,
) -> None:
    """Treat a non-2xx response as a connection/source failure."""
    app = web.Application()

    async def unavailable(_request: web.Request) -> web.Response:
        return web.Response(status=503, text="maintenance")

    app.router.add_get("/unavailable", unavailable)
    server = await aiohttp_server(app)

    with pytest.raises(WebDataConnectionError, match="Source returned HTTP 503"):
        await WebDataClient(hass).async_fetch(str(server.make_url("/unavailable")))
