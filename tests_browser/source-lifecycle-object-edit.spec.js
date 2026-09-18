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

test("editing a structured root-object source preserves object mode and nested attributes", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.addScriptTag({ path: LIFECYCLE_SCRIPT });
  await page.evaluate(() => {
    window.__webDataMessages = [];
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__webDataMessages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") {
          return {
            sources: [{
              entry_id: "structured-entry",
              title: "Structured Weather",
              state: "loaded",
              source_type: "json",
              url: "https://example.test/structured.json",
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
            entry_id: "structured-entry",
            source_name: "Structured Weather",
            source_type: "json",
            url: "https://example.test/structured.json",
            method: "GET",
            headers: {},
            verify_ssl: true,
            scan_interval: 5,
            failure_mode: "unavailable",
            long_text_policy: "truncate",
            entities: [{
              key: "structured_weather",
              name: "Structured Weather",
              value_type: "text",
              attributes: {
                current: "/current",
                alerts: "/alerts",
              },
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
              { name: "current", path: "/current", preview: "[object Object]", value_type: "dict" },
              { name: "alerts", path: "/alerts", preview: "Storm warning", value_type: "list" },
            ],
            values: [
              { path: "/current/temperature", display_path: "current.temperature", preview: "14.6", value_type: "float" },
            ],
          };
        }
        if (message.type === "web_data_assistant/update_source") {
          return {
            entry_id: "structured-entry",
            title: "Structured Weather",
            state: "loaded",
            source_type: "json",
            url: "https://example.test/structured.json",
            entity_count: 1,
            scan_interval: 5,
            failure_mode: "unavailable",
            source_available: true,
            extraction_error_count: 0,
            last_successful_update: "2026-09-17T17:20:00+00:00",
          };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Structured Weather" });
  await card.getByRole("button", { name: "Edit" }).click();

  const objectMode = shadow.getByRole("button", { name: /Import object as attributes/i });
  await expect(objectMode).toHaveClass(/active/);
  await expect(shadow.getByText("current", { exact: true })).toBeVisible();
  await expect(shadow.getByText("alerts", { exact: true })).toBeVisible();

  await shadow.getByRole("button", { name: "Save changes" }).click();

  const updateMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/update_source")
  );
  expect(updateMessage.entities).toEqual([{
    key: "structured_weather",
    name: "Structured Weather",
    value_type: "text",
    attributes: {
      current: "/current",
      alerts: "/alerts",
    },
  }]);
});
