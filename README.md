# Web Data Assistant

Web Data Assistant is a Home Assistant custom integration for creating sensors from websites and JSON APIs through a guided interface, without needing to write CSS selectors, JSON paths, or templates.

> **Development status:** early development. The current code is intended for development/testing rather than production use.

## What it does

Web Data Assistant starts with the data you want rather than the technical expression needed to retrieve it.

### JSON / API sources

1. Enter an endpoint URL and optional request settings.
2. Web Data Assistant fetches the real response through Home Assistant.
3. Browse and search the scalar values found in the JSON document.
4. Choose how the data should appear in Home Assistant.
5. Review friendly names, attributes, units and long-text handling before saving.
6. Everything selected from one source shares one HTTP request on each refresh.

The guided panel supports three JSON output modes:

- **Separate sensors** — each selected scalar value becomes its own Home Assistant sensor and state.
- **One sensor + attributes** — choose one selected value as the entity state, with the other selected values exposed as normal Home Assistant attributes. The state can also be left as the stable value `Loaded` when the entity is primarily an attribute container.
- **Import object as attributes** — the top-level keys of a JSON object become attributes on one entity. Nested objects and arrays remain structured dictionaries/lists rather than being flattened into artificial key names.

JSON locations are stored internally as RFC 6901 JSON Pointers, so unusual object keys do not require the user to build or escape a template expression. Attribute names are editable in the guided aggregate mode.

Guided scalar discovery is intentionally capped at 250 values to keep very large responses responsive. The preview API reports when additional values were omitted rather than treating the capped result as complete.

The older full-document `data` attribute representation remains supported by the backend/fallback flow for compatibility, but the guided panel now favours ordinary Home Assistant attributes for structured JSON data.

### Web page / scrape sources

The primary scrape workflow deliberately does **not** try to render the remote page inside Home Assistant.

1. Enter the page URL.
2. Use **Open page ↗** to view the real website in another browser tab.
3. Find the value you want and enter its current visible text into Web Data Assistant.
4. Home Assistant fetches the page in the background and finds the smallest meaningful HTML elements containing that text.
5. If several matches are found, choose the correct one using the surrounding-text context shown for each result.
6. Web Data Assistant generates and stores the CSS selector and match index internally.

The text entered during setup is only an identification aid. Runtime extraction uses the generated selector/index, so the value is free to change on later polls.

Text search ignores non-visible document content such as scripts, styles, templates and noscript blocks. Generated selector/index details are available only under advanced extraction details and are validated again against a fresh response before the source is created.

If text visible in the browser is absent from the fetched HTML response, the site may be inserting it with JavaScript. Web Data Assistant does not execute page JavaScript; in that situation the site's JSON/API request is normally a better source.

HTML parsing and extraction are moved off Home Assistant's event loop. Runtime scrape sources parse each fetched document once and extract all configured values from that shared parsed document.

## Long text values

Home Assistant limits entity states to 255 characters. Web Data Assistant does not discard valid source data just because a text value exceeds that limit.

Each source has a default long-text policy, and state-based sensors can override it individually:

- **Shorten state + preserve full value** — the recommended/default behaviour. The Home Assistant state is shortened safely, while the complete source value remains available in `full_value`; `state_truncated` is set to `true`.
- **Store full value as an attribute** — if the value grows beyond the state limit, the entity state becomes `Loaded` and the complete value is kept in `full_value`.
- **Mark unavailable if too long** — strict compatibility behaviour for users who prefer Home Assistant's state limit to make the entity unavailable.

Short values are unaffected by the selected policy. JSON values stored as attributes are not subject to the 255-character state limit, so this policy applies only to whichever extracted value is used as an entity state.

Retained-state restoration uses the complete `full_value`, not a previously shortened state.

## Failure behaviour

Each source can choose what its entities should do when the website or API cannot be reached:

- **Mark sensors unavailable** — keep the entities loaded in Home Assistant but mark them unavailable while the source cannot be reached.
- **Keep the last known value** — retain the most recent successful value during a temporary source outage.

Both modes keep the config entry and its entities loaded if Home Assistant starts while the remote source is offline. Retained values survive Home Assistant restarts and are replaced once live updates resume.

When keeping the last value, an optional maximum stale age can eventually make the entity unavailable if successful updates do not resume. The original last-success timestamp is restored too, and a timer updates availability at the configured deadline rather than waiting for a later polling attempt.

A source-connection failure and an extraction failure are deliberately treated differently. A temporary HTTP/DNS/timeout failure may retain the previous value when configured to do so. If the page/API loads but a configured selector or JSON pointer no longer exists, the affected entity becomes unavailable instead of silently presenting old data as current.

Sensors expose concise source-health information such as whether the latest source refresh succeeded and when the last successful update occurred. Connection errors are intentionally sanitized so request URLs or credentials are not exposed through state attributes.

## Home Assistant UI

Web Data Assistant has two setup surfaces:

- A dedicated **Web Data Assistant** admin panel provides the intended guided experience, including the richer JSON output modes and per-sensor long-text choices.
- A conventional Home Assistant config flow remains available as a simpler fallback/compatibility setup path.

Starting **Add Integration → Web Data Assistant** registers the guided panel immediately, so the visual workflow can be used before the first data source has been created.

The panel also includes a configured-source dashboard showing source type, privacy-safe endpoint, update interval, source health, last successful update and extraction-health information. Loaded sources can be refreshed manually from the panel.

Sensors created from the same source are grouped under one Home Assistant service device.

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
├── test_client_http.py
├── test_config_flow_runtime.py
├── test_extraction_preview.py
├── test_frontend_runtime.py
├── test_integration.py
├── test_json_attributes_runtime.py
├── test_runtime_semantics.py
├── test_scrape_flow_runtime.py
├── test_websocket_json_attributes.py
└── ...

tests_browser/
├── error-states.spec.js
├── json-filter-selection.spec.js
├── json-large.spec.js
├── json-pointer.spec.js
├── panel-load.spec.js
├── request-options.spec.js
├── responsive.spec.js
├── scrape-text.spec.js
├── source-health.spec.js
└── ...
```

`preview.py` and the internal HTML-preview WebSocket command remain for compatibility/testing, but the primary guided panel no longer embeds or renders a page preview.

## Validation

GitHub Actions performs Python compilation, JSON validation, frontend JavaScript syntax checking and Home Assistant hassfest validation.

A lightweight behavioral suite exercises extraction/HTML helper behavior without booting Home Assistant. It covers JSON Pointer escaping/resolution, discovery truncation, visible-text matching, extraction-error isolation and selector generation/sanitization helpers.

A separate runtime suite is pinned to **Home Assistant 2026.9.2** through `pytest-homeassistant-custom-component==0.13.365`. It boots the integration inside Home Assistant and verifies, among other things:

- config-entry setup and actual sensor state publication
- startup and later source outages
- keep-last and restore-state behavior across restarts
- exact stale-age expiry
- extraction failures remaining distinct from source failures and later recovery
- multiple values sharing one coordinator fetch and one service device
- JSON state + selected attributes on one entity
- structured nested JSON dictionaries/lists as entity attributes
- attribute-only JSON entities using the stable `Loaded` state
- all three long-text policies
- panel registration and management WebSocket APIs
- panel-driven source creation and manual source refresh
- privacy-safe URL display
- guided JSON/scrape fallback config flows and options reload
- WebSocket schema, authorization and JSON-attribute validation

The same Home Assistant job also exercises `WebDataClient` against a real local HTTP server, covering redirects, chunked responses, compressed data, non-2xx errors, malformed and non-standard JSON, charsets, declared and streaming response-size limits, request timeouts, and POST headers/body transmission.

A separate Playwright/Chromium suite renders the actual custom panel JavaScript and covers:

- clean initial rendering and configured-source loading
- JSON separate-sensor creation, names, units, scalar types and escaped pointers
- one JSON sensor with a selected state plus attributes
- root-object import with structured attributes
- text-first scrape matching and ambiguous-match disambiguation
- confirmation that the primary scrape panel does not use an iframe
- source/default long-text handling controls
- source health, stale retained states and manual refresh
- large/truncated JSON discovery and filtering
- narrow/mobile-width layout without horizontal overflow
- request settings, validation, error recovery and save-state preservation

The Chromium tests mock the panel's `hass.callWS` boundary so they remain deterministic and fast; the real Home Assistant suite independently exercises the actual WebSocket commands and integration runtime behind that boundary. The project does not yet launch the complete authenticated Home Assistant frontend shell in Playwright, so that full-stack UI boundary remains a later test opportunity.

To run the Home Assistant runtime suite locally, install `requirements-test.txt` and run the pytest files under `tests/`. Browser tests use `npm install`, `npx playwright install chromium`, and `npm run test:browser`.

## Installation

The integration contains HACS metadata, but it has not yet been prepared as a production release. For development, place `custom_components/web_data_assistant` in the Home Assistant `custom_components` directory and restart Home Assistant.
