"""Preview coverage for nested JSON object metadata."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant

from custom_components.web_data_assistant.const import DOMAIN
from custom_components.web_data_assistant.models import FetchResponse


async def test_preview_json_exposes_nested_object_nodes(
    hass: HomeAssistant,
    hass_ws_client,
) -> None:
    """Expose direct child metadata for nested objects, including objects in arrays."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert result["step_id"] == "user"

    response = FetchResponse(
        status=200,
        content_type="application/json",
        text="{}",
        json_data={
            "current": {
                "temperature": 14.6,
                "weather": {"condition": "Cloudy", "wind": {"speed": 18}},
            },
            "forecast": [
                {"day": "Friday", "high": 16},
                {"day": "Saturday", "high": 17},
            ],
        },
    )

    client = await hass_ws_client(hass)
    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ):
        await client.send_json(
            {
                "id": 1,
                "type": f"{DOMAIN}/preview_json",
                "url": "https://example.test/weather.json",
            }
        )
        message = await client.receive_json()

    assert message["success"] is True
    nodes = {node["path"]: node["fields"] for node in message["result"]["object_nodes"]}

    assert set(nodes) >= {
        "",
        "/current",
        "/current/weather",
        "/current/weather/wind",
        "/forecast/0",
        "/forecast/1",
    }
    assert nodes["/current"] == [
        {
            "name": "temperature",
            "path": "/current/temperature",
            "preview": "14.6",
            "value_type": "float",
        },
        {
            "name": "weather",
            "path": "/current/weather",
            "preview": "{'condition': 'Cloudy', 'wind': {'speed': 18}}",
            "value_type": "dict",
        },
    ]
    assert nodes["/forecast/0"] == [
        {
            "name": "day",
            "path": "/forecast/0/day",
            "preview": "Friday",
            "value_type": "str",
        },
        {
            "name": "high",
            "path": "/forecast/0/high",
            "preview": "16",
            "value_type": "int",
        },
    ]
