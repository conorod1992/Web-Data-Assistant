"""Real Home Assistant guided extraction repair tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_PATH,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    DOMAIN,
    FAILURE_UNAVAILABLE,
    SOURCE_JSON,
    VALUE_NUMBER,
)
from custom_components.web_data_assistant.models import FetchResponse


def _response(data: dict) -> FetchResponse:
    """Return a successful JSON response."""
    return FetchResponse(
        status=200,
        content_type="application/json",
        text="{}",
        json_data=data,
    )


async def test_list_sources_reports_repairable_extraction_issue_without_secrets(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Expose a safe per-entity repair issue without leaking request secrets."""
    secret_url = "https://user:password@example.test/weather?token=secret#private"
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Weather",
        data={
            CONF_SOURCE_NAME: "Weather",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: secret_url,
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "humidity",
                    "name": "Humidity",
                    CONF_PATH: "/current/humidity",
                    CONF_VALUE_TYPE: VALUE_NUMBER,
                }
            ],
        },
    )
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response({"current": {}})),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"{DOMAIN}/list_sources"})
    message = await client.receive_json()

    assert message["success"] is True
    source = message["result"]["sources"][0]
    assert source["url"] == "https://example.test/weather"
    assert source["extraction_error_count"] == 1
    assert source["extraction_issues"] == [
        {
            "key": "humidity",
            "name": "Humidity",
            "error": source["extraction_issues"][0]["error"],
            "repairable": True,
        }
    ]
    payload_text = str(source)
    assert "password" not in payload_text
    assert "token=secret" not in payload_text
    assert "private" not in payload_text
