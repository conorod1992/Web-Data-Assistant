# Web Data Assistant

Web Data Assistant is a Home Assistant custom integration for creating sensors from websites and JSON APIs through a friendly guided interface, without needing to write CSS selectors, JSON paths, or templates.

## Goals

The first release focuses on two guided source types:

- **JSON / API** — fetch a JSON response, browse discovered values, and create one or more sensors from selected paths.
- **Web page / scrape** — fetch a page, find a value by the text currently visible on the page, disambiguate multiple matches, and create a sensor from the selected element.

The integration is intentionally designed around what the user wants to retrieve rather than requiring them to understand the implementation details used to retrieve it.

## Planned v1 behaviour

- UI-first setup using Home Assistant config flows.
- Shared HTTP fetching for sensors that use the same source.
- Guided JSON discovery and selection.
- Guided HTML text discovery with contextual match selection.
- Generated extraction paths/selectors retained internally, with advanced details available when useful.
- Configurable refresh interval.
- Per-entry failure handling:
  - mark entities unavailable when an update fails, or
  - keep the last successfully retrieved value.
- Optional maximum stale age when retaining the previous value.
- Friendly diagnostics for connection failures and extraction failures.

## Status

Early development. The repository is not yet ready for production use.
