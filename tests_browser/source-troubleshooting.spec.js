const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(__dirname, "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js");
const LIFECYCLE_SCRIPT = path.resolve(__dirname, "../custom_components/web_data_assistant/frontend/source-lifecycle.js");

async function mountPanel(page, sources, refreshedSource = null) {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.addScriptTag({ path: LIFECYCLE_SCRIPT });
  await page.evaluate(({ initialSources, refreshed }) => {
    window.__refreshCalls = 0;
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        if (message.type === "web_data_assistant/list_sources") return { sources: initialSources };
        if (message.type === "web_data_assistant/refresh_source") {
          window.__refreshCalls += 1;
          if (refreshed) return refreshed;
          return initialSources.find((source) => source.entry_id === message.entry_id);
        }
        throw new Error(`Unexpected call: ${message.type}`);
      },
    };
  }, { initialSources: sources, refreshed: refreshedSource });
}

test("source outage explains retention and Try now can clear the issue", async ({ page }) => {
  const lastSuccess = new Date(Date.now() - 10 * 60_000).toISOString();
  const outage = {
    entry_id: "weather",
    title: "Weather API",
    state: "loaded",
    source_type: "json",
    url: "https://example.test/weather",
    entity_count: 2,
    scan_interval: 5,
    failure_mode: "keep_last",
    max_stale_minutes: 60,
    source_available: false,
    source_error: "Source returned HTTP 503",
    extraction_error_count: 0,
    extraction_issues: [],
    last_successful_update: lastSuccess,
  };
  const recovered = {
    ...outage,
    source_available: true,
    source_error: null,
    last_successful_update: new Date().toISOString(),
  };

  await mountPanel(page, [outage], recovered);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Weather API" });

  await expect(card.getByText("The source could not be reached")).toBeVisible();
  await expect(card).toContainText("Last known values are being retained");
  await expect(card).toContainText("remain valid until");
  await expect(card.getByRole("button", { name: "Try now" })).toBeVisible();

  await card.getByText("Technical details", { exact: true }).click();
  await expect(card).toContainText("Source returned HTTP 503");

  await card.getByRole("button", { name: "Try now" }).click();
  await expect(card.getByText("The source could not be reached")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Refresh now" })).toBeVisible();
  expect(await page.evaluate(() => window.__refreshCalls)).toBe(1);
});

test("expired retained values are explained as unavailable", async ({ page }) => {
  await mountPanel(page, [{
    entry_id: "expired",
    title: "Expired API",
    state: "loaded",
    source_type: "json",
    url: "https://example.test/expired",
    entity_count: 1,
    scan_interval: 5,
    failure_mode: "keep_last",
    max_stale_minutes: 30,
    source_available: false,
    source_error: "The request timed out",
    extraction_error_count: 0,
    extraction_issues: [],
    last_successful_update: "2000-01-01T00:00:00+00:00",
  }]);

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Expired API" });
  await expect(card).toContainText("retained-value age limit has been reached");
  await expect(card).toContainText("sensors are unavailable until the source recovers");
});

test("extraction issue names the sensor and configured target", async ({ page }) => {
  await mountPanel(page, [{
    entry_id: "changed",
    title: "Changed API",
    state: "loaded",
    source_type: "json",
    url: "https://example.test/changed",
    entity_count: 2,
    scan_interval: 5,
    failure_mode: "unavailable",
    source_available: true,
    source_error: null,
    extraction_error_count: 1,
    extraction_issues: [{
      key: "humidity",
      name: "Humidity",
      error: "Object key 'humidity' was not found",
      target: "State path: /current/humidity",
      repairable: true,
    }],
    last_successful_update: new Date().toISOString(),
  }]);

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Changed API" });
  await expect(card).toContainText("Humidity");
  await expect(card).toContainText("source loaded successfully");
  await expect(card.getByRole("button", { name: "Repair" })).toBeVisible();

  await card.getByText("Technical details", { exact: true }).click();
  await expect(card).toContainText("State path: /current/humidity");
  await expect(card).toContainText("Object key 'humidity' was not found");
});
