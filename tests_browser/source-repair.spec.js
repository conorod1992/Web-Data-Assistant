const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);
const LIFECYCLE_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/source-lifecycle.js"
);
const REPAIR_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/source-repair.js"
);
const SETUP_UX_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/source-setup-ux.js"
);

async function mountRepairPanel(page, { sourceType = "json", repairable = true } = {}) {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.addScriptTag({ path: LIFECYCLE_SCRIPT });
  await page.addScriptTag({ path: REPAIR_SCRIPT });
  await page.addScriptTag({ path: SETUP_UX_SCRIPT });
  await page.evaluate(({ type, isRepairable }) => {
    window.__webDataMessages = [];
    window.__repairApplied = false;
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__webDataMessages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") {
          return {
            sources: [{
              entry_id: "weather-entry",
              title: type === "json" ? "Weather API" : "Status Page",
              state: "loaded",
              source_type: type,
              url: type === "json" ? "https://example.test/weather.json" : "https://example.test/status",
              entity_count: 1,
              scan_interval: 5,
              failure_mode: "unavailable",
              source_available: true,
              extraction_error_count: window.__repairApplied ? 0 : 1,
              extraction_issues: window.__repairApplied ? [] : [{
                key: type === "json" ? "humidity" : "service_status",
                name: type === "json" ? "Humidity" : "Service Status",
                error: type === "json" ? "Object key 'humidity' was not found" : "Selector '.old-status' returned 0 elements",
                repairable: isRepairable,
              }],
              last_successful_update: "2026-09-18T00:30:00+00:00",
            }],
          };
        }
        if (message.type === "web_data_assistant/get_source") {
          return type === "json"
            ? {
                entry_id: "weather-entry",
                source_name: "Weather API",
                source_type: "json",
                url: "https://user:password@example.test/weather.json?token=secret",
                method: "GET",
                headers: { Authorization: "Bearer abc" },
                verify_ssl: true,
                scan_interval: 5,
                failure_mode: "unavailable",
                long_text_policy: "truncate",
                entities: [{
                  key: "humidity",
                  name: "Humidity",
                  path: "/old/humidity",
                  value_type: "number",
                  unit: "%",
                }],
              }
            : {
                entry_id: "weather-entry",
                source_name: "Status Page",
                source_type: "scrape",
                url: "https://example.test/status",
                method: "GET",
                headers: {},
                verify_ssl: true,
                scan_interval: 5,
                failure_mode: "unavailable",
                long_text_policy: "truncate",
                entities: [{
                  key: "service_status",
                  name: "Service Status",
                  selector: ".old-status",
                  index: 0,
                  value_type: "text",
                }],
              };
        }
        if (message.type === "web_data_assistant/preview_json") {
          return {
            status: 200,
            content_type: "application/json",
            truncated: false,
            root_type: "dict",
            root_fields: [
              { name: "current", path: "/current", preview: "{...}", value_type: "dict" },
            ],
            values: [
              { path: "/current/temperature", display_path: "current.temperature", preview: "14.6", value_type: "float" },
              { path: "/current/humidity", display_path: "current.humidity", preview: "82", value_type: "int" },
            ],
          };
        }
        if (message.type === "web_data_assistant/search_html") {
          return {
            matches: [
              {
                selector: ".current-status",
                index: 0,
                text: "Online",
                context: "API service Online",
                tag: "span",
              },
              {
                selector: ".historic-status",
                index: 0,
                text: "Online",
                context: "Yesterday Online",
                tag: "span",
              },
            ],
          };
        }
        if (message.type === "web_data_assistant/repair_entity") {
          window.__repairApplied = true;
          return {
            entry_id: "weather-entry",
            entity_key: message.entity_key,
            source: {
              entry_id: "weather-entry",
              title: type === "json" ? "Weather API" : "Status Page",
              state: "loaded",
              source_type: type,
              url: type === "json" ? "https://example.test/weather.json" : "https://example.test/status",
              entity_count: 1,
              scan_interval: 5,
              failure_mode: "unavailable",
              source_available: true,
              extraction_error_count: 0,
              extraction_issues: [],
              last_successful_update: "2026-09-18T00:31:00+00:00",
            },
          };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  }, { type: sourceType, isRepairable: repairable });
}

test("repairs a broken JSON sensor by selecting a replacement path", async ({ page }) => {
  await mountRepairPanel(page, { sourceType: "json" });
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Weather API" });

  await expect(card.getByText("Humidity", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Repair" }).click();

  await expect(shadow.getByRole("heading", { name: "2. Choose the replacement value" })).toBeVisible();
  await expect(shadow.getByText(/Current stored path:/)).toContainText("/old/humidity");
  await expect(shadow.getByLabel("URL")).toBeDisabled();
  await shadow.getByText("Advanced request settings", { exact: true }).click();
  await expect(shadow.getByLabel("Header name 1")).toBeDisabled();
  await expect(shadow.getByLabel("Header value 1")).toBeDisabled();

  await shadow.locator(".repair-option").filter({ hasText: "current.humidity" }).locator("input").check();
  await shadow.getByRole("button", { name: "Apply repair" }).click();

  await expect(shadow.getByText("Repaired Humidity successfully.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Repair" })).toHaveCount(0);

  const message = await page.evaluate(() =>
    window.__webDataMessages.find((item) => item.type === "web_data_assistant/repair_entity")
  );
  expect(message).toEqual({
    type: "web_data_assistant/repair_entity",
    entry_id: "weather-entry",
    entity_key: "humidity",
    path: "/current/humidity",
  });
});

test("repairs a broken scrape sensor through contextual text matching", async ({ page }) => {
  await mountRepairPanel(page, { sourceType: "scrape" });
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Status Page" });

  await card.getByRole("button", { name: "Repair" }).click();
  await expect(shadow.getByRole("heading", { name: "2. Find the replacement value" })).toBeVisible();

  await shadow.getByLabel("Current text or value").fill("Online");
  await shadow.getByRole("button", { name: "Find matches" }).click();
  await expect(shadow.getByText("API service Online")).toBeVisible();
  await expect(shadow.getByText("Yesterday Online")).toBeVisible();

  await shadow.locator(".match").filter({ hasText: "API service Online" }).click();
  await shadow.getByRole("button", { name: "Apply repair" }).click();

  await expect(shadow.getByText("Repaired Service Status successfully.")).toBeVisible();

  const message = await page.evaluate(() =>
    window.__webDataMessages.find((item) => item.type === "web_data_assistant/repair_entity")
  );
  expect(message).toEqual({
    type: "web_data_assistant/repair_entity",
    entry_id: "weather-entry",
    entity_key: "service_status",
    selector: ".current-status",
    index: 0,
  });
});

test("complex JSON extraction issues direct the user to Edit", async ({ page }) => {
  await mountRepairPanel(page, { sourceType: "json", repairable: false });
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Weather API" });

  await expect(card.getByRole("button", { name: "Repair" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Use Edit" })).toBeVisible();
});
