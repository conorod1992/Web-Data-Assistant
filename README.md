# Web Data Assistant

Web Data Assistant is a Home Assistant custom integration for creating sensors from websites and JSON APIs through a friendly guided interface, without needing to write CSS selectors, JSON paths, or templates.

> **Development status:** early development. The current code is intended for development/testing rather than production use.

## What it does

Web Data Assistant starts with the data you want rather than the technical expression needed to retrieve it.

### JSON / API sources

1. Enter an endpoint URL and optional request settings.
2. Web Data Assistant fetches the real response through Home Assistant.
3. Browse and search the scalar values found in the JSON document.
4. Select one or more values to create as sensors.
5. Review friendly sensor names and optional units before saving.
6. The selected values share one HTTP request on each refresh.

JSON locations are stored internally as RFC 6901 JSON Pointers, so unusual object keys do not require the user to build or escape a template expression.

Guided discovery is intentionally capped at 250 scalar values to keep very large responses responsive. The preview API reports when additional values were omitted rather than treating the capped result as complete.

A source can alternatively keep the complete JSON response in a sensor attribute. This is useful for later templates or automations, but the UI warns that large or frequently changing attributes can increase Recorder database usage.

### Web page / scrape sources

1. Enter the page URL and load it through Home Assistant.
2. Web Data Assistant creates a sanitized, script-free preview of the fetched HTML.
3. Either click the wanted element directly or enter text/value that is currently visible on the page.
4. If the text occurs in multiple specific elements, choose the correct match using its surrounding context.
5. Optionally give the resulting sensor a unit.
6. Web Data Assistant generates and stores the CSS selector and match index internally.

Text search ignores non-visible document content such as scripts, styles, templates and noscript blocks so the guided search remains aligned with what the user can actually see.

The generated selector/index are shown only under advanced extraction details. They are validated again against a fresh response before the source is created.

The preview is rendered from server-fetched HTML rather than framing the remote website. Scripts, forms, nested frames, objects and active navigation are removed, and the preview is additionally sandboxed and protected with a restrictive Content Security Policy.

HTML parsing and extraction are moved off Home Assistant's event loop. Runtime scrape sources parse each fetched document once and extract all configured values from that shared parsed document.

## Failure behaviour

Each source can choose what its entities should do when the website or API cannot be reached:

- **Mark sensors unavailable** — keep the entities loaded in Home Assistant but mark them unavailable while the source cannot be reached.
- **Keep the last known value** — retain the most recent successful value during a temporary source outage.

Both modes keep the config entry and its entities loaded if Home Assistant starts while the remote source is offline. This means the selected failure policy controls the entity state rather than an outage preventing the source from loading at all.

Retained values survive Home Assistant restarts. If Home Assistant starts while the remote source is already offline, the entities can restore their previous successful state and replace it once live updates resume.

When keeping the last value, an optional maximum stale age can eventually make the entity unavailable if successful updates do not resume. The original last-success timestamp is restored too, and a timer updates availability at the configured deadline rather than waiting for a later polling attempt.

A source-connection failure and an extraction failure are deliberately treated differently. A temporary HTTP/DNS/timeout failure may retain the previous value when configured to do so. If the page loads but the configured selector or JSON path no longer exists, the affected entity becomes unavailable instead of silently presenting old data as current.

Sensors expose concise source-health information such as whether the latest source refresh succeeded and when the last successful update occurred. Connection errors are intentionally sanitized so request URLs or credentials are not exposed through state attributes.

## Home Assistant UI

Web Data Assistant has two setup surfaces:

- A dedicated **Web Data Assistant** admin panel provides the intended guided visual experience.
- A conventional Home Assistant config flow remains available as a fallback.

Starting **Add Integration → Web Data Assistant** registers the guided panel immediately, so the visual workflow can be used before the first data source has been created.

The panel also includes a configured-source dashboard showing source type, privacy-safe endpoint, update interval, source health, last successful update and extraction-health information. Loaded sources can be refreshed manually from the panel.

Sensors created from the same source are grouped under one Home Assistant service device.

## Long values

Home Assistant limits entity states to 255 characters. If a scraped or API text value exceeds that limit, Web Data Assistant publishes a safe shortened state and preserves the complete text in the `full_value` attribute. Retained-state restoration uses the complete value, not the shortened state.

Full JSON responses are handled separately: the sensor state is `Loaded` and the structured response is stored in the `data` attribute.

## Request support

The current v1 foundation supports:

- GET and POST requests
- optional request headers
- optional raw POST body
- configurable SSL certificate verification
- configurable polling interval
- a 20-second request timeout
- a 2 MB response-size safety limit
- bounded/chunk-aware response reading

## Deliberate v1 limits

The first version is intentionally not trying to be a browser automation engine or a general-purpose HTTP client.

Not currently in scope:

- JavaScript execution/headless-browser rendering
- automatic understanding of repeated cards, rows or tables
- OAuth/browser login flows
- pagination or chained requests
- automatic repair of changed page layouts
- arbitrary transformation pipelines

Repeated-container detection remains a promising later enhancement, but the initial implementation keeps selector generation simple enough to understand and stress-test first.

## Privacy and diagnostics

Diagnostics intentionally omit request header values, request bodies, current source values, URL credentials, query parameters and fragments. Extraction definitions and source-health metadata remain available to help diagnose failures.

The management panel similarly receives privacy-safe endpoint strings rather than the full stored URL, so query-string credentials are not echoed into the browser UI.

## Repository layout

```text
custom_components/web_data_assistant/
├── __init__.py
├── client.py
├── config_flow.py
├── const.py
├── coordinator.py
├── diagnostics.py
├── extraction.py
├── frontend.py
├── frontend/
│   └── web-data-assistant-panel.js
├── management.py
├── manifest.json
├── models.py
├── preview.py
├── sensor.py
├── strings.json
├── translations/
│   └── en.json
└── websocket.py

tests/
├── conftest.py
├── test_config_flow_runtime.py
├── test_extraction_preview.py
├── test_frontend_runtime.py
├── test_integration.py
├── test_runtime_semantics.py
└── test_scrape_flow_runtime.py
```

## Validation

GitHub Actions performs Python compilation, JSON validation, frontend JavaScript syntax checking and Home Assistant hassfest validation.

A lightweight behavioral suite exercises the pure extraction and preview helpers without booting Home Assistant. It covers JSON Pointer escaping/resolution, discovery truncation, visible-text matching, extraction-error isolation, preview sanitization, URL-secret removal and generated-selector fidelity.

A separate runtime suite is pinned to **Home Assistant 2026.9.2** through `pytest-homeassistant-custom-component==0.13.365`. It boots the integration inside Home Assistant and currently verifies:

- config-entry setup and actual sensor state publication
- startup source outages and unavailable entities
- keep-last behavior during later source outages
- restore-state behavior when Home Assistant restarts while the source is offline
- exact stale-age expiry using Home Assistant time events
- HTML scrape extraction, full-JSON attributes and long-state handling
- multiple JSON sensors sharing one coordinator fetch and one HA service device
- extraction failures remaining distinct from source failures and recovering on a later refresh
- sidebar panel registration and the management WebSocket API
- panel-driven `create_source` creating a working Home Assistant config entry
- manual source refresh and privacy-safe URL display
- guided JSON and guided scrape config-flow persistence
- invalid source URL rejection
- options-flow persistence and automatic runtime reload

The runtime suite tests Home Assistant registration, state, config-flow and WebSocket behavior. It does **not** currently run a browser and therefore does not provide visual-regression coverage for the rendered custom panel itself.

To run the Home Assistant runtime suite locally, install `requirements-test.txt` and run the pytest files under `tests/`.

## Installation

The integration contains HACS metadata, but it has not yet been prepared as a production release. For development, place `custom_components/web_data_assistant` in the Home Assistant `custom_components` directory and restart Home Assistant.
