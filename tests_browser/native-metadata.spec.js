const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);
const SETUP_UX_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/source-setup-ux.js"
);
const JSON_UX_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/source-json-ux.js"
);
const LIFECYCLE_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/source-lifecycle.js"
);

async function mountPanel(page, { lifecycle = false } = {}) {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  if (lifecycle) await page.addScriptTag({ path: LIFECYCLE_SCRIPT });
  await page.addScriptTag({ path: SETUP_UX_SCRIPT });
  await page.addScriptTag({ path: JSON_UX_SCRIPT });
  await page.evaluate(({ lifecycleMode }) => {
    window.__webDataMessages = [];
    window.__updated = false;
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__webDataMessages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") {
          return {
            sources: lifecycleMode ? [{
              entry_id: "weather-entry",
              title: "Weather",
              state: "loaded",
              source_type: "json",
              url: "https://example.test/weather.json",
              entity_count: 1,
              scan_interval: 5,
              failure_mode: "unavailable",
              source_available: true,
              extraction_error_count: 0,
              last_successful_update: "2026-09-18T18:00:00+00:00",
            }] : [],
          };
        }
        if (lifecycleMode && message.type === "web_data_assistant/get_source") {
          return {
            entry_id: "weather-entry",
            source_name: "Weather",
            source_type: "json",
            url: "https://example.test/weather.json",
            method: "GET",
            headers: {},
            verify_ssl: true,
            scan_interval: 5,
            failure_mode: "unavailable",
            long_text_policy: "truncate",
            entities: [{
              key: "temperature",
              name: "Outdoor Temperature",
              path: "/current/temperature",
              value_type: "number",
              unit: "°C",
              device_class: "temperature",
              state_class: "measurement",
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
              { name: "meter", path: "/meter", preview: "{...}", value_type: "dict" },
            ],
            values: [
              { path: "/current/temperature", display_path: "current.temperature", preview: "14.6", value_type: "float" },
              { path: "/current/humidity", display_path: "current.humidity", preview: "82", value_type: "int" },
              { path: "/meter/total_consumption", display_path: "meter.total_consumption", preview: "1234.5", value_type: "float" },
            ],
          };
        }
        if (message.type === "web_data_assistant/create_source") return { entry_id: "created" };
        if (message.type === "web_data_assistant/update_source") {
          window.__updated = true;
          return {
            entry_id: "weather-entry",
            title: "Weather",
            state: "loaded",
            source_type: "json",
            url: "https://example.test/weather.json",
            entity_count: 1,
            scan_interval: 5,
            failure_mode: "unavailable",
            source_available: true,
            extraction_error_count: 0,
            last_successful_update: "2026-09-18T18:01:00+00:00",
          };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  }, { lifecycleMode: lifecycle });
}

test("numeric JSON sensors receive conservative native Home Assistant suggestions", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByLabel("Source name").fill("Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();

  await shadow.locator('.json-check[data-path="/current/temperature"]').check();
  await shadow.locator('.json-unit[data-path="/current/temperature"]').fill("°C");
  await shadow.locator('.json-unit[data-path="/current/temperature"]').blur();

  const row = shadow.locator(".sensor-review-row").filter({ hasText: "current.temperature" });
  const device = row.getByLabel("Home Assistant type");
  const state = row.getByLabel("Statistics behavior");
  await expect(device).toHaveValue("auto");
  await expect(device.locator("option:checked")).toHaveText("Suggested: Temperature");
  await expect(state).toHaveValue("auto");
  await expect(state.locator("option:checked")).toHaveText("Suggested: Measurement");

  const preview = shadow.locator(".ha-create-preview");
  await expect(preview).toContainText("Home Assistant type:");
  await expect(preview).toContainText("temperature");
  await expect(preview).toContainText("Statistics:");
  await expect(preview).toContainText("measurement");

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();
  const create = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(create.entities).toEqual([
    {
      key: "current_temperature",
      name: "Temperature",
      path: "/current/temperature",
      value_type: "number",
      unit: "°C",
      device_class: "temperature",
      state_class: "measurement",
    },
  ]);
});

test("cumulative energy gets energy and total-increasing suggestions", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByLabel("Source name").fill("Meter");
  await shadow.getByLabel("URL").fill("https://example.test/meter.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();

  await shadow.locator('.json-check[data-path="/meter/total_consumption"]').check();
  await shadow.locator('.json-unit[data-path="/meter/total_consumption"]').fill("kWh");
  await shadow.locator('.json-unit[data-path="/meter/total_consumption"]').blur();

  const row = shadow.locator(".sensor-review-row").filter({ hasText: "meter.total_consumption" });
  await expect(row.getByLabel("Home Assistant type").locator("option:checked")).toHaveText("Suggested: Energy");
  await expect(row.getByLabel("Statistics behavior").locator("option:checked")).toHaveText("Suggested: Total increasing");

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();
  const create = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(create.entities[0]).toMatchObject({
    device_class: "energy",
    state_class: "total_increasing",
  });
});

test("native metadata can be explicitly disabled", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByLabel("Source name").fill("Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();
  await shadow.locator('.json-check[data-path="/current/humidity"]').check();
  await shadow.locator('.json-unit[data-path="/current/humidity"]').fill("%");
  await shadow.locator('.json-unit[data-path="/current/humidity"]').blur();

  const row = shadow.locator(".sensor-review-row").filter({ hasText: "current.humidity" });
  await row.getByLabel("Home Assistant type").selectOption("none");
  await row.getByLabel("Statistics behavior").selectOption("none");

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();
  const create = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(create.entities[0].device_class).toBeUndefined();
  expect(create.entities[0].state_class).toBeUndefined();
});

test("aggregate JSON state receives native metadata suggestions", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByLabel("Source name").fill("Weather Summary");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();
  await shadow.getByRole("button", { name: /One sensor \+ attributes/ }).click();
  await shadow.locator('.json-check[data-path="/current/temperature"]').check();
  await shadow.locator('.json-check[data-path="/current/humidity"]').check();
  await shadow.locator('.json-state[value="/current/temperature"]').check();
  await shadow.getByLabel("State unit (optional)").fill("°C");
  await shadow.getByLabel("State unit (optional)").blur();

  await expect(shadow.getByLabel("Home Assistant type").locator("option:checked")).toHaveText("Suggested: Temperature");
  await expect(shadow.getByLabel("Statistics behavior").locator("option:checked")).toHaveText("Suggested: Measurement");

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();
  const create = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(create.entities[0]).toMatchObject({
    path: "/current/temperature",
    device_class: "temperature",
    state_class: "measurement",
  });
});

test("Edit preserves stored native metadata instead of re-suggesting it", async ({ page }) => {
  await mountPanel(page, { lifecycle: true });
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.locator(".source-card").filter({ hasText: "Weather" }).getByRole("button", { name: "Edit" }).click();

  const row = shadow.locator(".sensor-review-row").filter({ hasText: "current.temperature" });
  await expect(row.getByLabel("Home Assistant type")).toHaveValue("temperature");
  await expect(row.getByLabel("Statistics behavior")).toHaveValue("measurement");
  await expect(shadow.locator(".ha-create-preview")).toContainText("temperature");
  await expect(shadow.locator(".ha-create-preview")).toContainText("measurement");

  await shadow.getByRole("button", { name: "Save changes" }).click();
  const update = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/update_source")
  );
  expect(update.entities[0]).toMatchObject({
    key: "temperature",
    device_class: "temperature",
    state_class: "measurement",
  });
});
