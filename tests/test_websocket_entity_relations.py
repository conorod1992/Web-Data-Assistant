"""Cross-field entity validation tests for Web Data Assistant."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant

from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_PATH,
    CONF_SELECTOR,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    DOMAIN,
    FAILURE_UNAVAILABLE,
    SOURCE_JSON,
    VALUE_NUMBER,
)


async def test_create_source_rejects_html_selector_on_json_sensor(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Reject an HTML selector attached to an otherwise valid JSON sensor."""
    flow = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert flow["step_id"] == "user"

    fetch = AsyncMock()
    client = await hass_ws_client(hass)
    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/create_source",
                CONF_SOURCE_NAME: "Wrong Extraction Type",
                CONF_SOURCE_TYPE: SOURCE_JSON,
                CONF_URL: "https://example.test/data.json",
                CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
                CONF_ENTITIES: [
                    {
                        "key": "temperature",
                        "name": "Temperature",
                        CONF_PATH: "/temperature",
                        CONF_SELECTOR: ".temperature",
                        CONF_VALUE_TYPE: VALUE_NUMBER,
                    }
                ],
            }
        )
        message = await client.receive_json()

    assert message["success"] is False
    assert message["error"]["code"] == "invalid_entities"
    assert "JSON sensors cannot contain an HTML selector" in message["error"]["message"]
    fetch.assert_not_awaited()
    assert hass.config_entries.async_entries(DOMAIN) == []
