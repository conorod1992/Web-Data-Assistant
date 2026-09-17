"""Real HTTP transport tests for Web Data Assistant."""

from __future__ import annotations

import pytest
from aiohttp import web
from homeassistant.core import HomeAssistant

from custom_components.web_data_assistant.client import (
    WebDataClient,
    WebDataConnectionError,
    WebDataResponseError,
)
from custom_components.web_data_assistant.const import MAX_RESPONSE_BYTES


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


async def test_client_rejects_malformed_json_response(
    hass: HomeAssistant,
    aiohttp_server,
    socket_enabled,
) -> None:
    """Treat invalid JSON from a successful response as a response/data error."""
    app = web.Application()

    async def malformed(_request: web.Request) -> web.Response:
        return web.Response(
            status=200,
            text='{"temperature": 14.6,',
            content_type="application/json",
        )

    app.router.add_get("/malformed", malformed)
    server = await aiohttp_server(app)

    with pytest.raises(
        WebDataResponseError,
        match="responded successfully but did not return valid JSON",
    ):
        await WebDataClient(hass).async_fetch(
            str(server.make_url("/malformed")),
            parse_json=True,
        )


async def test_client_rejects_oversized_content_length(
    hass: HomeAssistant,
    aiohttp_server,
    socket_enabled,
) -> None:
    """Reject a response whose declared body length exceeds the safety cap."""
    app = web.Application()
    oversized = b"x" * (MAX_RESPONSE_BYTES + 1)

    async def too_large(_request: web.Request) -> web.Response:
        return web.Response(body=oversized, content_type="text/plain")

    app.router.add_get("/too-large", too_large)
    server = await aiohttp_server(app)

    with pytest.raises(
        WebDataResponseError,
        match="response is too large to process safely",
    ):
        await WebDataClient(hass).async_fetch(str(server.make_url("/too-large")))


async def test_client_rejects_oversized_chunked_response(
    hass: HomeAssistant,
    aiohttp_server,
    socket_enabled,
) -> None:
    """Enforce the safety cap even when the server omits Content-Length."""
    app = web.Application()
    chunk = b"x" * (64 * 1024)
    chunk_count = (MAX_RESPONSE_BYTES // len(chunk)) + 2

    async def too_large_chunked(request: web.Request) -> web.StreamResponse:
        response = web.StreamResponse(status=200)
        await response.prepare(request)
        try:
            for _ in range(chunk_count):
                await response.write(chunk)
            await response.write_eof()
        except ConnectionResetError:
            pass
        return response

    app.router.add_get("/too-large-chunked", too_large_chunked)
    server = await aiohttp_server(app)

    with pytest.raises(
        WebDataResponseError,
        match="response is too large to process safely",
    ):
        await WebDataClient(hass).async_fetch(
            str(server.make_url("/too-large-chunked"))
        )
