"""Real Home Assistant contracts for ranked and custom scrape locators."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from bs4 import BeautifulSoup
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.web_data_assistant.const import DOMAIN
from custom_components.web_data_assistant.models import FetchResponse, WebDataEntityConfig


HTML = '<nav><a>Navigation</a></nav><section id="weather"><a class="reading">14°C</a></section>'


def response(html: str = HTML) -> FetchResponse:
    return FetchResponse(status=200, content_type="text/html", text=html)


async def start(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()


async def test_search_returns_ranked_locators_for_the_exact_selected_node(hass, hass_ws_client):
    await start(hass)
    client = await hass_ws_client(hass)
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=AsyncMock(return_value=response())):
        await client.send_json({"id": 1, "type": f"{DOMAIN}/search_html", "url": "https://example.test/weather", "search_text": "14°C"})
        message = await client.receive_json()
    assert message["success"] is True
    match = message["result"]["matches"][0]
    assert match["selector"] != "a"
    assert match["index"] == 0
    assert match["match_count"] == 1
    assert 1 <= len(match["candidates"]) <= 5
    assert match["candidates"][0]["selector"] == match["selector"]
    soup = BeautifulSoup(HTML, "html.parser")
    target = soup.select_one("#weather a")
    for candidate in match["candidates"]:
        matches = soup.select(candidate["selector"])
        assert matches[candidate["index"]] is target
        assert len(matches) == candidate["match_count"]
        assert "score" not in candidate


async def test_custom_selector_test_returns_sample_count_and_context_without_creating_entry(hass, hass_ws_client):
    await start(hass)
    client = await hass_ws_client(hass)
    before = list(hass.config_entries.async_entries(DOMAIN))
    fetch = AsyncMock(return_value=response())
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=fetch):
        await client.send_json({"id": 1, "type": f"{DOMAIN}/test_html_selector", "url": "https://example.test/weather", "selector": "a", "index": 1})
        message = await client.receive_json()
    assert message["success"] is True
    assert message["result"]["selector"] == "a"
    assert message["result"]["index"] == 1
    assert message["result"]["match_count"] == 2
    assert message["result"]["text"] == "14°C"
    assert "14°C" in message["result"]["context"]
    assert list(hass.config_entries.async_entries(DOMAIN)) == before
    fetch.assert_awaited_once()


@pytest.mark.parametrize("selector,index,code,requests", [
    ("[", 0, "invalid_selector", 0),
    ("a", -1, "invalid_format", 0),
    ("a", 0.5, "invalid_format", 0),
    (".absent", 0, "invalid_selection", 1),
    ("a", 99, "invalid_selection", 1),
])
async def test_invalid_selector_tests_are_actionable_and_do_not_write(hass, hass_ws_client, selector, index, code, requests):
    await start(hass)
    client = await hass_ws_client(hass)
    fetch = AsyncMock(return_value=response())
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=fetch):
        await client.send_json({"id": 1, "type": f"{DOMAIN}/test_html_selector", "url": "https://example.test/weather", "selector": selector, "index": index})
        message = await client.receive_json()
    assert message["success"] is False
    assert message["error"]["code"] == code
    assert fetch.await_count == requests
    assert not hass.config_entries.async_entries(DOMAIN)


async def test_custom_selector_requires_admin_before_network_access(hass, hass_ws_client, hass_read_only_access_token):
    await start(hass)
    client = await hass_ws_client(hass, hass_read_only_access_token)
    fetch = AsyncMock(return_value=response())
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=fetch):
        await client.send_json({"id": 1, "type": f"{DOMAIN}/test_html_selector", "url": "https://example.test/weather", "selector": "a", "index": 0})
        message = await client.receive_json()
    assert message["success"] is False
    assert message["error"]["code"] == "unauthorized"
    fetch.assert_not_awaited()


async def test_custom_test_supports_stored_attribute_extraction(hass, hass_ws_client):
    await start(hass)
    client = await hass_ws_client(hass)
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=AsyncMock(return_value=response('<a id="status" title="Available">Online</a>'))):
        await client.send_json({"id": 1, "type": f"{DOMAIN}/test_html_selector", "url": "https://example.test/weather", "selector": "#status", "attribute": "title"})
        message = await client.receive_json()
    assert message["success"] is True
    assert message["result"]["text"] == "Available"


async def test_guarded_creation_detects_changed_count_and_recovers_without_affecting_sibling(hass, hass_ws_client):
    await start(hass)
    client = await hass_ws_client(hass)
    fetch = AsyncMock(return_value=response())
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=fetch):
        await client.send_json({
            "id": 1, "type": f"{DOMAIN}/create_source", "source_name": "Weather", "source_type": "scrape",
            "url": "https://example.test/weather", "failure_mode": "keep_last", "entities": [
                {"key": "reading", "name": "Reading", "selector": "#weather a", "index": 0, "value_type": "text", "expected_match_count": 1},
                {"key": "nav", "name": "Nav", "selector": "nav a", "index": 0, "value_type": "text"},
            ],
        })
        saved = await client.receive_json()
        assert saved["success"] is True
        await hass.async_block_till_done()
        entry = hass.config_entries.async_get_entry(saved["result"]["entry_id"])
        assert entry.data["entities"][0]["expected_match_count"] == 1
        registry = er.async_get(hass)
        entity_id = registry.async_get_entity_id("sensor", DOMAIN, f"{entry.entry_id}_reading")
        sibling_id = registry.async_get_entity_id("sensor", DOMAIN, f"{entry.entry_id}_nav")
        assert hass.states.get(entity_id).state == "14°C"
        fetch.return_value = response('<nav><a>Navigation</a></nav><section id="weather"><a>Wrong</a><a>18°C</a></section>')
        await entry.runtime_data.async_refresh()
        await hass.async_block_till_done()
        assert entry.runtime_data.last_update_success is True
        assert "match count changed" in entry.runtime_data.extraction_error_for("reading")
        assert hass.states.get(entity_id).state == "unavailable"
        assert hass.states.get(sibling_id).state == "Navigation"
        fetch.return_value = response(HTML.replace("14°C", "18°C"))
        await entry.runtime_data.async_refresh()
        await hass.async_block_till_done()
        assert hass.states.get(entity_id).state == "18°C"
        assert registry.async_get_entity_id("sensor", DOMAIN, f"{entry.entry_id}_reading") == entity_id


async def test_fresh_validation_rejects_guard_mismatch_before_create(hass, hass_ws_client):
    await start(hass)
    client = await hass_ws_client(hass)
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=AsyncMock(return_value=response())):
        await client.send_json({"id": 1, "type": f"{DOMAIN}/create_source", "source_name": "Weather", "source_type": "scrape", "url": "https://example.test/weather", "entities": [{"key": "value", "name": "Value", "value_type": "text", "selector": "a", "index": 0, "expected_match_count": 1}]})
        message = await client.receive_json()
    assert message["success"] is False
    assert message["error"]["code"] == "validation_failed"
    assert not hass.config_entries.async_entries(DOMAIN)


async def test_repair_replaces_guard_and_preserves_entity_identity(hass, hass_ws_client):
    entry = MockConfigEntry(domain=DOMAIN, title="Weather", data={
        "source_name": "Weather", "source_type": "scrape", "url": "https://example.test/weather",
        "entities": [{"key": "reading", "name": "Reading", "selector": ".missing", "index": 0, "value_type": "text", "expected_match_count": 5}],
    })
    entry.add_to_hass(hass)
    fetch = AsyncMock(return_value=response())
    with patch("custom_components.web_data_assistant.client.WebDataClient.async_fetch", new=fetch):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        registry = er.async_get(hass)
        before = registry.async_get_entity_id("sensor", DOMAIN, f"{entry.entry_id}_reading")
        client = await hass_ws_client(hass)
        await client.send_json({"id": 1, "type": f"{DOMAIN}/repair_entity", "entry_id": entry.entry_id, "entity_key": "reading", "selector": "#weather a", "index": 0, "expected_match_count": 1})
        result = await client.receive_json()
        await hass.async_block_till_done()
    assert result["success"] is True
    assert entry.data["entities"][0]["expected_match_count"] == 1
    assert registry.async_get_entity_id("sensor", DOMAIN, f"{entry.entry_id}_reading") == before
    assert hass.states.get(before).state == "14°C"


def test_legacy_configs_do_not_gain_a_guard_implicitly():
    config = {"key": "value", "name": "Value", "selector": "a", "index": 16, "value_type": "text"}
    restored = WebDataEntityConfig.from_dict(config)
    assert restored.expected_match_count is None
    assert restored.as_dict() == config
