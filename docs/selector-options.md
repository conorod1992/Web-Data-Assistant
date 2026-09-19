# Choosing a scrape selector

Web Data Assistant keeps the text-first setup flow: open the real website separately, enter the value currently visible there, and choose the correct contextual match. It does not embed or execute the website.

## Default and advanced choices

The recommended selector is selected automatically. You do not need to open Advanced to create a sensor.

**Advanced selector options** shows up to five alternatives verified against the exact same HTML element in the searched response. Each option includes its selector, number of matches, any required zero-based index, and an explanation. Choosing an alternative does not discard the sensor name, unit, or long-text setting.

The shortlist is intentionally not an exhaustive dump. It favours a small mix of useful approaches over many nearly identical CSS expressions.

### How recommendations are ranked

The generator considers escaped IDs, a small allowlist of identifying attributes, descriptive class combinations, and selectors scoped to identified ancestors. It tries descendant selectors before relying on relative child positions. A short `nth-of-type` path inside an identified section is preferable to an index among every link on the page, but still depends on layout. Bare tag plus document-order index is a last resort.

Generated selectors do not search for the current measured text. They also do not capture `href`, `src`, arbitrary `data-*` attributes, or obviously generated IDs/state classes. This avoids pinning a changing value or article URL into the extraction and reduces accidental inclusion of URL secrets. Advanced users can still deliberately write their own selectors.

Candidate verification compares actual node identity, not BeautifulSoup's markup equality. Two identical sibling links must remain distinguishable.

### What the ratings mean

- **Strong:** a unique ID/identifying attribute or a unique selection within a well-identified section.
- **Moderate:** a unique class-based or relative structural locator that can depend on styling or layout.
- **Fragile:** a broad or multi-match locator whose meaning depends on page order, including a bare tag that happens to be unique today.

These are structural heuristics from one response, not confidence percentages or promises of future stability. A website can change even a descriptive ID. A selector is not considered strong just because a long positional path returns one match.

Generation is bounded: no more than five recommendations, five ancestor levels, and a fixed candidate-evaluation budget per selected element. Search/selection work runs outside Home Assistant's event loop. The integration still uses the site's HTTP response rather than JavaScript-rendered browser content.

## Testing a custom selector

Enter **Custom CSS selector** and **Match index (starts at 0)**, then press **Test selector**. Home Assistant fetches a fresh response and uses the same parser and extraction functions as normal polling. The result shows the sample value, context, and match count.

Testing does not create or change an entity. Press **Use tested selector** to apply the result, then add the sensor or apply the repair. Check the sample: a syntactically valid selector can still point to the wrong element.

Changing the selector, index, or request settings invalidates the tested result. Late responses from a cancelled picker or a different source are ignored. Invalid syntax, no matches, an out-of-range index, and connection failures leave the previous applied selection intact. A stored HTML attribute extraction is preserved during Repair.

The custom test endpoint is admin-only. It uses the existing request validation, timeouts, response-size limit, and sanitized transport errors. It neither writes config entries nor executes remote scripts. Repeated tests of a configured POST source perform that configured POST request; they are not a browser-only preview.

## Detecting changed matches

New panel selections made with a known match count store an `expected_match_count` alongside the selector/index. Saving validates that count against a fresh response. Polling reports an **extraction error** when the count changes instead of quietly reading a shifted index; other sensors on that source continue independently.

This guard does not prove semantic identity. Reordering elements while keeping the same count can still fool a positional locator. Stronger anchors remain the main defence. Extraction failures use the integration's existing unavailable/Repair behaviour, not the source-outage keep-last policy.

## Existing sensors and Repair

There is no automatic selector migration or auto-healing. Existing configurations without a match-count guard retain their previous behaviour. Edit and Duplicate preserve existing guards and HTML attribute extraction. The standard Home Assistant config flow benefits from improved automatic recommendations; the shortlist and custom tester are panel features.

Repair offers the same shortlist and custom tester. It updates the selected extraction while retaining the entity key and Home Assistant identity. Its match-count guard is validated for the new selector rather than inherited from the old one. Already-saved healthy selectors are not changed merely by installing the update.

## Validation boundaries

Pure helper regressions mutate pages by adding unrelated links/wrappers, changing readings and reordering identified cards; they also cover identical siblings, duplicate IDs, CSS escaping and deterministic bounded output. Real-HA tests cover the actual preview WebSocket, authorization, save validation, repair, count-change isolation/recovery and legacy compatibility.

The new browser suite loads the actual production ES-module entrypoint with all feature modules, then tests recommended/alternative/custom selection, invalidation, Repair, Edit/Duplicate and narrow-screen behaviour. Its WebSocket transport is a fixture; this browser suite is not a claim that a full authenticated Home Assistant shell is launched.
