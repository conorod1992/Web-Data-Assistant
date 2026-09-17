"""HTTP client for Web Data Assistant sources."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DEFAULT_REQUEST_TIMEOUT, METHOD_GET
from .models import FetchResponse


class WebDataError(Exception):
    """Base error raised by Web Data Assistant."""


class WebDataConnectionError(WebDataError):
    """Raised when a source cannot be reached successfully."""


class WebDataResponseError(WebDataError):
    """Raised when a source returns an unusable response."""


class WebDataClient:
    """Small Home Assistant-aware HTTP client shared by setup and coordinators."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialise the client."""
        self._session = async_get_clientsession(hass)

    async def async_fetch(
        self,
        url: str,
        *,
        method: str = METHOD_GET,
        headers: dict[str, str] | None = None,
        payload: str | None = None,
        verify_ssl: bool = True,
        parse_json: bool = False,
    ) -> FetchResponse:
        """Fetch one web source and optionally decode JSON."""
        request_kwargs: dict[str, Any] = {
            "headers": headers or None,
            "ssl": None if verify_ssl else False,
        }
        if payload is not None and method.upper() != METHOD_GET:
            request_kwargs["data"] = payload

        try:
            async with asyncio.timeout(DEFAULT_REQUEST_TIMEOUT):
                async with self._session.request(
                    method.upper(),
                    url,
                    **request_kwargs,
                ) as response:
                    text = await response.text(errors="replace")
                    if response.status < 200 or response.status >= 300:
                        raise WebDataConnectionError(
                            f"Source returned HTTP {response.status}"
                        )
                    content_type = response.headers.get("Content-Type", "")
        except TimeoutError as err:
            raise WebDataConnectionError("The request timed out") from err
        except aiohttp.ClientError as err:
            raise WebDataConnectionError(str(err)) from err

        json_data: Any | None = None
        if parse_json:
            try:
                json_data = json.loads(text)
            except (TypeError, ValueError) as err:
                raise WebDataResponseError(
                    "The source responded successfully but did not return valid JSON"
                ) from err

        return FetchResponse(
            status=response.status,
            content_type=content_type,
            text=text,
            json_data=json_data,
        )
