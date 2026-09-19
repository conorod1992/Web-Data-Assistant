"""HTTP client for Web Data Assistant sources."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DEFAULT_REQUEST_TIMEOUT, MAX_RESPONSE_BYTES, METHOD_GET
from .models import FetchResponse


class WebDataError(Exception):
    """Base error raised by Web Data Assistant."""


class WebDataConnectionError(WebDataError):
    """Raised when a source cannot be reached successfully."""


class WebDataResponseError(WebDataError):
    """Raised when a source returns an unusable response."""


def _reject_non_standard_json_constant(value: str) -> None:
    """Reject NaN and Infinity constants that are not valid JSON."""
    raise ValueError(f"Invalid JSON constant: {value}")


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
        etag: str | None = None,
        last_modified: str | None = None,
    ) -> FetchResponse:
        """Fetch one web source and optionally decode JSON."""
        request_headers = dict(headers or {})
        lower_header_names = {name.casefold() for name in request_headers}
        if etag and "if-none-match" not in lower_header_names:
            request_headers["If-None-Match"] = etag
        if last_modified and "if-modified-since" not in lower_header_names:
            request_headers["If-Modified-Since"] = last_modified
        conditional_request = bool(etag or last_modified)

        request_kwargs: dict[str, Any] = {
            "headers": request_headers or None,
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
                    if response.status == 304 and conditional_request:
                        return FetchResponse(
                            status=304,
                            content_type=response.headers.get("Content-Type", ""),
                            text="",
                            json_data=None,
                            etag=response.headers.get("ETag") or etag,
                            last_modified=(
                                response.headers.get("Last-Modified") or last_modified
                            ),
                            not_modified=True,
                        )

                    if response.status < 200 or response.status >= 300:
                        raise WebDataConnectionError(
                            f"Source returned HTTP {response.status}"
                        )

                    if (
                        response.content_length is not None
                        and response.content_length > MAX_RESPONSE_BYTES
                    ):
                        raise WebDataResponseError(
                            "The source response is too large to process safely"
                        )

                    chunks: list[bytes] = []
                    received = 0
                    async for chunk in response.content.iter_chunked(64 * 1024):
                        received += len(chunk)
                        if received > MAX_RESPONSE_BYTES:
                            raise WebDataResponseError(
                                "The source response is too large to process safely"
                            )
                        chunks.append(chunk)
                    body = b"".join(chunks)

                    charset = response.charset or "utf-8"
                    try:
                        text = body.decode(charset, errors="replace")
                    except LookupError:
                        text = body.decode("utf-8", errors="replace")
                    content_type = response.headers.get("Content-Type", "")
                    status = response.status
                    response_etag = response.headers.get("ETag")
                    response_last_modified = response.headers.get("Last-Modified")
        except TimeoutError as err:
            raise WebDataConnectionError("The request timed out") from err
        except aiohttp.ClientError as err:
            # Do not surface aiohttp's raw exception string: connector errors can
            # contain the requested URL, including sensitive query parameters.
            error_type = type(err).__name__
            raise WebDataConnectionError(
                f"The source could not be reached ({error_type})"
            ) from err

        json_data: Any | None = None
        if parse_json:
            try:
                json_data = json.loads(
                    text,
                    parse_constant=_reject_non_standard_json_constant,
                )
            except (TypeError, ValueError) as err:
                raise WebDataResponseError(
                    "The source responded successfully but did not return valid JSON"
                ) from err

        return FetchResponse(
            status=status,
            content_type=content_type,
            text=text,
            json_data=json_data,
            etag=response_etag,
            last_modified=response_last_modified,
        )
