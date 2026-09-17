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
5. The selected values share one HTTP request on each refresh.

JSON locations are stored internally as RFC 6901 JSON Pointers, so unusual object keys do not require the user to build or escape a template expression.

A source can alternatively keep the complete JSON response in a sensor attribute. This is useful for later templates or automations, but the UI warns that large or frequently changing attributes can increase Recorder database usage.

### Web page / scrape sources

1. Enter the page URL and load it through Home Assistant.
2. Web Data Assistant creates a sanitized, script-free preview of the fetched HTML.
3. Either click the wanted element directly or enter text/value that is currently visible on the page.
4. If the text occurs in multiple specific elements, choose the correct match using its surrounding context.
5. Web Data Assistant generates and stores the CSS selector and match index internally.

The generated selector/index are shown only under advanced extraction details. They are validated again against a fresh response before the source is created.

The preview is rendered from server-fetched HTML rather than framing the remote website. Scripts, forms, nested frames, objects and active navigation are removed, and the preview is additionally sandboxed and protected with a restrictive Content Security Policy.

## Failure behaviour

Each source can choose what its entities should do when the website or API cannot be reached:

- **Mark sensors unavailable** — the traditional Home Assistant-style behaviour.
- **Keep the last known value** — retain the most recent successful value during a temporary source outage.

When keeping the last value, an optional maximum stale age can eventually make the entity unavailable if successful updates do not resume.

A source-connection failure and an extraction failure are deliberately treated differently. A temporary HTTP/DNS/timeout failure may retain the previous value when configured to do so. If the page loads but the configured selector or JSON path no longer exists, the affected entity becomes unavailable instead of silently presenting old data as current.

Sensors expose concise source-health information such as whether the latest source refresh succeeded and when the last successful update occurred.

## Home Assistant UI

Web Data Assistant has two setup surfaces:

- A dedicated **Web Data Assistant** admin panel provides the intended guided visual experience.
- A conventional Home Assistant config flow remains available as a fallback.

Starting **Add Integration → Web Data Assistant** registers the guided panel immediately, so the visual workflow can be used before the first data source has been created.

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
├── manifest.json
├── models.py
├── preview.py
├── sensor.py
├── strings.json
├── translations/
│   └── en.json
└── websocket.py
```

## Installation

The integration already contains HACS metadata, but it has not yet been prepared as a production release. For development, place `custom_components/web_data_assistant` in the Home Assistant `custom_components` directory and restart Home Assistant.

No automated test suite has been added at this stage.
