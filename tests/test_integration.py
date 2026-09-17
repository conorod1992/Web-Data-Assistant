"""Real Home Assistant smoke tests for Web Data Assistant."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed_exact,
    mock_restore_cache,
)

from custom_components.web_data_assistant.client import WebDataConnectionError
from custom_components.web_data_assistant.const import (
    CONF_ENTITIES,
    CONF_FAILURE_MODE,
    CONF_INDEX,
    CONF_MAX_STALE_MINUTES,
    CONF_PATH,
    CONF_SELECTOR,
    CONF_SOURCE_NAME,
    CONF_SOURCE_TYPE,
    CONF_URL,
    CONF_VALUE_TYPE,
    DOMAIN,
    FAILURE_KEEP_LAST,
    FAILURE_UNAVAILABLE,
    SOURCE_JSON,
    SOURCE_SCRAPE,
    VALUE_JSON,
    VALUE_NUMBER,
    VALUE_TEXT,
)
from custom_components.web_data_assistant.models import FetchResponse


def _json_entry(
    failure_mode: str = FAILURE_UNAVAILABLE,
    *,
    max_stale_minutes: int | None = None,
) -> MockConfigEntry:
    """Return a simple JSON-backed config entry."""
    data = {
        CONF_SOURCE_NAME: "Weather API",
        CONF_SOURCE_TYPE: SOURCE_JSON,
        CONF_URL: "https://example.test/weather.json",
        CONF_FAILURE_MODE: failure_mode,
        CONF_ENTITIES: [
            {
                "key": "temperature",
                "name": "Temperature",
                CONF_PATH: "/current/temperature",
                CONF_VALUE_TYPE: VALUE_NUMBER,
            }
        ],
    }
    if max_stale_minutes is not None:
        data[CONF_MAX_STALE_MINUTES] = max_stale_minutes

    return MockConfigEntry(
        domain=DOMAIN,
        title="Weather API",
        data=data,
    )


def _response(value: float = 14.6) -> FetchResponse:
    """Return a successful JSON response containing a temperature."""
    return FetchResponse(
        status=200,
        content_type="application/json",
        text=f'{{"current":{{"temperature":{value}}}}}',
        json_data={"current": {"temperature": value}},
    )


def _entity_id(hass: HomeAssistant, entry: MockConfigEntry, key: str = "temperature") -> str:
    """Return a registered Web Data Assistant sensor entity id."""
    entity_id = er.async_get(hass).async_get_entity_id(
        "sensor",
        DOMAIN,
        f"{entry.entry_id}_{key}",
    )
    assert entity_id is not None
    return entity_id


async def test_json_entry_sets_up_real_sensor(hass: HomeAssistant) -> None:
    """Set up a config entry through HA and publish an extracted sensor state."""
    entry = _json_entry()
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=_response()),
    ) as fetch:
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    fetch.assert_awaited_once()

    state = hass.states.get(_entity_id(hass, entry))
    assert state is not None
    assert state.state == "14.6"
    assert state.attributes["source_available"] is True
    assert "last_successful_update" in state.attributes


async def test_unreachable_source_loads_unavailable_sensor(hass: HomeAssistant) -> None:
    """Keep the entry loaded and expose an unavailable sensor after startup failure."""
    entry = _json_entry(FAILURE_UNAVAILABLE)
    entry.add_to_hass(hass)

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(side_effect=WebDataConnectionError("The request timed out")),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    state = hass.states.get(_entity_id(hass, entry))
    assert state is not None
    assert state.state == STATE_UNAVAILABLE


async def test_keep_last_survives_runtime_source_outage(hass: HomeAssistant) -> None:
    """Retain the last successful state when a later source refresh fails."""
    entry = _json_entry(FAILURE_KEEP_LAST)
    entry.add_to_hass(hass)
    fetch = AsyncMock(return_value=_response())

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

        entity_id = _entity_id(hass, entry)
        initial = hass.states.get(entity_id)
        assert initial is not None
        assert initial.state == "14.6"
        last_success = initial.attributes["last_successful_update"]

        fetch.side_effect = WebDataConnectionError("The request timed out")
        await entry.runtime_data.async_request_refresh()
        await hass.async_block_till_done()

    state = hass.states.get(entity_id)
    assert state is not None
    assert state.state == "14.6"
    assert state.attributes["source_available"] is False
    assert state.attributes["last_successful_update"] == last_success
    assert state.attributes["source_error"] == "The request timed out"


async def test_keep_last_restores_state_when_source_is_offline_at_startup(
    hass: HomeAssistant,
) -> None:
    """Restore the previous HA state when startup cannot reach a keep-last source."""
    entry = _json_entry(FAILURE_KEEP_LAST)
    entry.add_to_hass(hass)

    registry_entry = er.async_get(hass).async_get_or_create(
        "sensor",
        DOMAIN,
        f"{entry.entry_id}_temperature",
        suggested_object_id="restored_temperature",
        config_entry=entry,
    )
    restored_at = "2026-09-17T12:00:00+00:00"
    mock_restore_cache(
        hass,
        [
            State(
                registry_entry.entity_id,
                "13.2",
                attributes={"last_successful_update": restored_at},
            )
        ],
    )

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(side_effect=WebDataConnectionError("The request timed out")),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    state = hass.states.get(registry_entry.entity_id)
    assert state is not None
    assert state.state == "13.2"
    assert state.attributes["source_available"] is False
    assert state.attributes["last_successful_update"] == restored_at
    assert state.attributes["source_error"] == "The request timed out"


async def test_keep_last_becomes_unavailable_at_stale_deadline(
    hass: HomeAssistant,
    freezer,
) -> None:
    """Expire a retained state at the configured maximum stale age."""
    start = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)
    freezer.move_to(start)

    entry = _json_entry(FAILURE_KEEP_LAST, max_stale_minutes=30)
    entry.add_to_hass(hass)
    fetch = AsyncMock(return_value=_response())

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        entity_id = _entity_id(hass, entry)

        fetch.side_effect = WebDataConnectionError("The request timed out")
        await entry.runtime_data.async_request_refresh()
        await hass.async_block_till_done()

        retained = hass.states.get(entity_id)
        assert retained is not None
        assert retained.state == "14.6"

        expired = start + timedelta(minutes=31)
        freezer.move_to(expired)
        async_fire_time_changed_exact(hass, expired)
        await hass.async_block_till_done()

    state = hass.states.get(entity_id)
    assert state is not None
    assert state.state == STATE_UNAVAILABLE


async def test_scrape_entry_publishes_selected_html_text(hass: HomeAssistant) -> None:
    """Extract a configured HTML selector through the real HA sensor platform."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Status Page",
        data={
            CONF_SOURCE_NAME: "Status Page",
            CONF_SOURCE_TYPE: SOURCE_SCRAPE,
            CONF_URL: "https://example.test/status",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "service_status",
                    "name": "Service status",
                    CONF_SELECTOR: ".service-status",
                    CONF_INDEX: 0,
                    CONF_VALUE_TYPE: VALUE_TEXT,
                }
            ],
        },
    )
    entry.add_to_hass(hass)
    response = FetchResponse(
        status=200,
        content_type="text/html",
        text='<html><body><span class="service-status">Online</span></body></html>',
        json_data=None,
    )

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    state = hass.states.get(_entity_id(hass, entry, "service_status"))
    assert state is not None
    assert state.state == "Online"
    assert state.attributes["source_available"] is True


async def test_full_json_capture_uses_structured_attribute(hass: HomeAssistant) -> None:
    """Publish full JSON as structured data while keeping the state compact."""
    payload = {"current": {"temperature": 14.6}, "alerts": ["wind", "rain"]}
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="API Snapshot",
        data={
            CONF_SOURCE_NAME: "API Snapshot",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/snapshot.json",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "snapshot",
                    "name": "Snapshot",
                    CONF_PATH: "",
                    CONF_VALUE_TYPE: VALUE_JSON,
                }
            ],
        },
    )
    entry.add_to_hass(hass)
    response = FetchResponse(
        status=200,
        content_type="application/json",
        text='{"current":{"temperature":14.6},"alerts":["wind","rain"]}',
        json_data=payload,
    )

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    state = hass.states.get(_entity_id(hass, entry, "snapshot"))
    assert state is not None
    assert state.state == "Loaded"
    assert state.attributes["data"] == payload


async def test_long_text_state_is_bounded_and_preserved(hass: HomeAssistant) -> None:
    """Keep HA state within 255 chars while retaining the complete extracted text."""
    long_value = "x" * 320
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Long Message",
        data={
            CONF_SOURCE_NAME: "Long Message",
            CONF_SOURCE_TYPE: SOURCE_JSON,
            CONF_URL: "https://example.test/message.json",
            CONF_FAILURE_MODE: FAILURE_UNAVAILABLE,
            CONF_ENTITIES: [
                {
                    "key": "message",
                    "name": "Message",
                    CONF_PATH: "/message",
                    CONF_VALUE_TYPE: VALUE_TEXT,
                }
            ],
        },
    )
    entry.add_to_hass(hass)
    response = FetchResponse(
        status=200,
        content_type="application/json",
        text='{"message":"' + long_value + '"}',
        json_data={"message": long_value},
    )

    with patch(
        "custom_components.web_data_assistant.client.WebDataClient.async_fetch",
        new=AsyncMock(return_value=response),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    state = hass.states.get(_entity_id(hass, entry, "message"))
    assert state is not None
    assert len(state.state) == 255
    assert state.state.endswith("…")
    assert state.attributes["full_value"] == long_value
    assert state.attributes["state_truncated"] is True
