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

async function mountPanel(page, { lifecycle = false } = {}) {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.addScriptTag({ path: LIFECYCLE_SCRIPT });
  await page.evaluate(({ lifecycleMode }) => {
    window.__webDataMessages = [];
    window.__webDataUpdated = false;
    window.__webDataDuplicated = false;
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__webDataMessages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") {
          const sources = [{
            entry_id: "weather-entry",
            title: window.__webDataUpdated ? "Renamed Weather" : "Weather API",
            state: "loaded",
            source_type: "json",
            url: "https://example.test/weather",
            entity_count: window.__webDataUpdated ? 1 : 2,
            scan_interval: window.__webDataUpdated ? 15 : 5,
            failure_mode: "unavailable",
            source_available: true,
            extraction_error_count: 0,
            last_successful_update: "2026-09-17T17:20:00+00:00",
          }];
          if (window.__webDataDuplicated) {
            sources.push({
              entry_id: "weather-copy-entry",
              title: "Weather API copy",
              state: "loaded",
              source_type: "json",
              url: "https://example.test/weather",
              entity_count: 2,
              scan_interval: 5,
              failure_mode: "unavailable",
              source_available: true,
              extraction_error_count: 0,
              last_successful_update: "2026-09-17T17:20:00+00:00",
            });
          }
          return { sources };
        }
        if (message.type === "web_data_assistant/delete_source") {
          return { entry_id: message.entry_id };
        }
        if (lifecycleMode && message.type === "web_data_assistant/get_source") {
          return {
            entry_id: "weather-entry",
            source_name: "Weather API",
            source_type: "json",
            url: "https://user:password@example.test/weather?token=secret",
            method: "GET",
            headers: { Authorization: "Bearer abc" },
            verify_ssl: true,
            scan_interval: 5,
            failure_mode: "unavailable",
            long_text_policy: "truncate",
            entities: [
              { key: "temperature", name: "Temperature", path: "/temperature", value_type: "number", unit: "°C" },
              { key: "humidity", name: "Humidity", path: "/humidity", value_type: "number", unit: "%" },
            ],
          };
        }
        if (lifecycleMode && message.type === "web_data_assistant/preview_json") {
          return {
            status: 200,
            content_type: "application/json",
            truncated: false,
            root_type: "dict",
            root_fields: [
              { name: "temperature", path: "/temperature", preview: "14.6", value_type: "float" },
              { name: "humidity", path: "/humidity", preview: "82", value_type: "int" },
            ],
            values: [
              { path: "/temperature", display_path: "temperature", preview: "14.6", value_type: "float" },
              { path: "/humidity", display_path: "humidity", preview: "82", value_type: "int" },
            ],
          };
        }
        if (lifecycleMode && message.type === "web_data_assistant/update_source") {
          window.__webDataUpdated = true;
          return {
            entry_id: "weather-entry",
            title: "Renamed Weather",
            state: "loaded",
            source_type: "json",
            url: "https://example.test/weather",
            entity_count: 1,
            scan_interval: 15,
            failure_mode: "unavailable",
            source_available: true,
            extraction_error_count: 0,
            last_successful_update: "2026-09-17T17:20:00+00:00",
          };
        }
        if (lifecycleMode && message.type === "web_data_assistant/create_source") {
          window.__webDataDuplicated = true;
          return { entry_id: "weather-copy-entry" };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  }, { lifecycleMode: lifecycle });
}

test("deleting a source requires inline confirmation and removes its card", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Weather API" });

  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(card.getByText("Delete Weather API?")).toBeVisible();
  await expect(card.getByText(/removes the source and its Home Assistant sensor entities/i)).toBeVisible();

  let deleteMessages = await page.evaluate(() =>
    window.__webDataMessages.filter((message) => message.type === "web_data_assistant/delete_source")
  );
  expect(deleteMessages).toEqual([]);

  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByText("Delete Weather API?")).toHaveCount(0);

  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await card.getByRole("button", { name: "Delete source" }).click();

  await expect(card).toHaveCount(0);
  await expect(shadow.getByText("Deleted Weather API.")).toBeVisible();

  deleteMessages = await page.evaluate(() =>
    window.__webDataMessages.filter((message) => message.type === "web_data_assistant/delete_source")
  );
  expect(deleteMessages).toEqual([{
    type: "web_data_assistant/delete_source",
    entry_id: "weather-entry",
  }]);
});

test("editing a JSON source preloads its config and preserves unchanged entity keys", async ({ page }) => {
  await mountPanel(page, { lifecycle: true });
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Weather API" });

  await card.getByRole("button", { name: "Edit" }).click();

  await expect(shadow.getByLabel("Source name")).toHaveValue("Weather API");
  await expect(shadow.getByLabel("URL")).toHaveValue("https://user:password@example.test/weather?token=secret");
  await expect(shadow.getByLabel("Headers (JSON object)")).toContainText("Bearer abc");
  await expect(shadow.getByRole("heading", { name: "Edit source" })).toBeVisible();

  const temperature = shadow.locator(".json-row").filter({ hasText: "temperature" }).locator("input[type=checkbox]");
  const humidity = shadow.locator(".json-row").filter({ hasText: "humidity" }).locator("input[type=checkbox]");
  await expect(temperature).toBeChecked();
  await expect(humidity).toBeChecked();

  await shadow.getByLabel("Source name").fill("Renamed Weather");
  await shadow.getByLabel("Update interval (minutes)").fill("15");
  await humidity.uncheck();
  await shadow.getByRole("button", { name: "Save changes" }).click();

  await expect(shadow.getByText("Updated Renamed Weather successfully.")).toBeVisible();
  await expect(shadow.locator(".source-card").filter({ hasText: "Renamed Weather" })).toBeVisible();

  const updateMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/update_source")
  );
  expect(updateMessage.entry_id).toBe("weather-entry");
  expect(updateMessage.source_name).toBe("Renamed Weather");
  expect(updateMessage.scan_interval).toBe(15);
  expect(updateMessage.url).toBe("https://user:password@example.test/weather?token=secret");
  expect(updateMessage.headers).toEqual({ Authorization: "Bearer abc" });
  expect(updateMessage.entities).toEqual([
    { key: "temperature", name: "Temperature", path: "/temperature", value_type: "number", unit: "°C" },
  ]);
});

test("duplicating a source preloads a copy and creates a separate source", async ({ page }) => {
  await mountPanel(page, { lifecycle: true });
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Weather API" });

  await card.getByRole("button", { name: "Duplicate" }).click();

  await expect(shadow.getByRole("heading", { name: "Duplicate source" })).toBeVisible();
  await expect(shadow.getByLabel("Source name")).toHaveValue("Weather API copy");
  await expect(shadow.getByLabel("URL")).toHaveValue("https://user:password@example.test/weather?token=secret");

  const temperature = shadow.locator(".json-row").filter({ hasText: "temperature" }).locator("input[type=checkbox]");
  const humidity = shadow.locator(".json-row").filter({ hasText: "humidity" }).locator("input[type=checkbox]");
  await expect(temperature).toBeChecked();
  await expect(humidity).toBeChecked();

  await shadow.getByRole("button", { name: "Create copy" }).click();

  await expect(shadow.getByText("Created Weather API copy successfully.")).toBeVisible();
  await expect(shadow.locator(".source-card").filter({ hasText: "Weather API copy" })).toBeVisible();

  const createMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(createMessage.source_name).toBe("Weather API copy");
  expect(createMessage.url).toBe("https://user:password@example.test/weather?token=secret");
  expect(createMessage.entities).toEqual([
    { key: "temperature", name: "Temperature", path: "/temperature", value_type: "number", unit: "°C" },
    { key: "humidity", name: "Humidity", path: "/humidity", value_type: "number", unit: "%" },
  ]);

  const updateMessages = await page.evaluate(() =>
    window.__webDataMessages.filter((message) => message.type === "web_data_assistant/update_source")
  );
  expect(updateMessages).toEqual([]);
});
