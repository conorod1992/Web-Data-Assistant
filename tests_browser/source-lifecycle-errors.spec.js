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

test("failed source edit keeps the populated edit form available", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.addScriptTag({ path: LIFECYCLE_SCRIPT });
  await page.evaluate(() => {
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        if (message.type === "web_data_assistant/list_sources") {
          return {
            sources: [{
              entry_id: "weather-entry",
              title: "Weather API",
              state: "loaded",
              source_type: "json",
              url: "https://example.test/weather",
              entity_count: 1,
              scan_interval: 5,
              failure_mode: "unavailable",
              source_available: true,
              extraction_error_count: 0,
              last_successful_update: "2026-09-17T17:20:00+00:00",
            }],
          };
        }
        if (message.type === "web_data_assistant/get_source") {
          return {
            entry_id: "weather-entry",
            source_name: "Weather API",
            source_type: "json",
            url: "https://example.test/weather.json",
            method: "GET",
            headers: {},
            verify_ssl: true,
            scan_interval: 5,
            failure_mode: "unavailable",
            long_text_policy: "truncate",
            entities: [
              { key: "temperature", name: "Temperature", path: "/temperature", value_type: "number", unit: "°C" },
            ],
          };
        }
        if (message.type === "web_data_assistant/preview_json") {
          return {
            status: 200,
            content_type: "application/json",
            truncated: false,
            root_type: "dict",
            root_fields: [
              { name: "temperature", path: "/temperature", preview: "14.6", value_type: "float" },
            ],
            values: [
              { path: "/temperature", display_path: "temperature", preview: "14.6", value_type: "float" },
            ],
          };
        }
        if (message.type === "web_data_assistant/update_source") {
          throw new Error("Edited source could not be reloaded");
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Weather API" });
  await card.getByRole("button", { name: "Edit" }).click();

  await shadow.getByLabel("Source name").fill("My edited weather");
  await shadow.getByLabel("Update interval (minutes)").fill("20");
  await shadow.getByRole("button", { name: "Save changes" }).click();

  await expect(shadow.locator(".notice.error")).toContainText("Edited source could not be reloaded");
  await expect(shadow.getByRole("heading", { name: "Edit source" })).toBeVisible();
  await expect(shadow.getByLabel("Source name")).toHaveValue("My edited weather");
  await expect(shadow.getByLabel("Update interval (minutes)")).toHaveValue("20");
  await expect(shadow.getByRole("button", { name: "Save changes" })).toBeVisible();
  await expect(shadow.getByRole("button", { name: "Cancel edit" })).toBeVisible();
});
