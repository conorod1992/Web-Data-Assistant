const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

async function mountWithSources(page, sources) {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate((configuredSources) => {
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        if (message.type === "web_data_assistant/list_sources") return { sources: configuredSources };
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  }, sources);
}

test("source dashboard distinguishes unavailable, retained and extraction-degraded health", async ({ page }) => {
  await mountWithSources(page, [
    {
      entry_id: "offline",
      title: "Offline Source",
      state: "loaded",
      source_type: "json",
      url: "https://example.test/offline",
      entity_count: 1,
      scan_interval: 5,
      failure_mode: "unavailable",
      source_available: false,
      extraction_error_count: 0,
      last_successful_update: null,
    },
    {
      entry_id: "retained",
      title: "Retained Source",
      state: "loaded",
      source_type: "json",
      url: "https://example.test/retained",
      entity_count: 1,
      scan_interval: 5,
      failure_mode: "keep_last",
      source_available: false,
      extraction_error_count: 0,
      last_successful_update: "2026-09-17T16:00:00+00:00",
    },
    {
      entry_id: "degraded",
      title: "Changed API",
      state: "loaded",
      source_type: "json",
      url: "https://example.test/changed",
      entity_count: 2,
      scan_interval: 5,
      failure_mode: "keep_last",
      source_available: true,
      extraction_error_count: 1,
      last_successful_update: "2026-09-17T17:00:00+00:00",
    },
  ]);

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  const offline = shadow.locator(".source-card").filter({ hasText: "Offline Source" });
  await expect(offline.locator(".health" )).toHaveClass(/unavailable/);
  await expect(offline.locator(".health")).toContainText("Source unavailable");

  const retained = shadow.locator(".source-card").filter({ hasText: "Retained Source" });
  await expect(retained.locator(".health")).toHaveClass(/retained/);
  await expect(retained.locator(".health")).toContainText("Source unavailable · retained");

  const degraded = shadow.locator(".source-card").filter({ hasText: "Changed API" });
  await expect(degraded.locator(".health")).toHaveClass(/degraded/);
  await expect(degraded.locator(".health")).toContainText("1 extraction issue");
  await expect(degraded).toContainText("1 extraction issue");
});
