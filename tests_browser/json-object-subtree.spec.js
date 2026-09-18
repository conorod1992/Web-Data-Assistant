const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(__dirname, "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js");
const LIFECYCLE_SCRIPT = path.resolve(__dirname, "../custom_components/web_data_assistant/frontend/source-lifecycle.js");
const SETUP_UX_SCRIPT = path.resolve(__dirname, "../custom_components/web_data_assistant/frontend/source-setup-ux.js");
const JSON_UX_SCRIPT = path.resolve(__dirname, "../custom_components/web_data_assistant/frontend/source-json-ux.js");

const preview = {
  status: 200,
  content_type: "application/json",
  truncated: false,
  root_type: "dict",
  root_fields: [
    { name: "current", path: "/current", preview: "{...}", value_type: "dict" },
    { name: "forecast", path: "/forecast", preview: "[...]", value_type: "list" },
  ],
  object_nodes: [
    {
      path: "",
      fields: [
        { name: "current", path: "/current", preview: "{...}", value_type: "dict" },
        { name: "forecast", path: "/forecast", preview: "[...]", value_type: "list" },
      ],
    },
    {
      path: "/current",
      fields: [
        { name: "temperature", path: "/current/temperature", preview: "14.6", value_type: "float" },
        { name: "humidity", path: "/current/humidity", preview: "82", value_type: "int" },
        { name: "weather", path: "/current/weather", preview: "{'condition': 'Cloudy'}", value_type: "dict" },
      ],
    },
    {
      path: "/current/weather",
      fields: [
        { name: "condition", path: "/current/weather/condition", preview: "Cloudy", value_type: "str" },
      ],
    },
    {
      path: "/forecast/0",
      fields: [
        { name: "day", path: "/forecast/0/day", preview: "Friday", value_type: "str" },
        { name: "high", path: "/forecast/0/high", preview: "16", value_type: "int" },
      ],
    },
  ],
  values: [
    { path: "/current/temperature", display_path: "current.temperature", preview: "14.6", value_type: "float" },
    { path: "/current/humidity", display_path: "current.humidity", preview: "82", value_type: "int" },
    { path: "/current/weather/condition", display_path: "current.weather.condition", preview: "Cloudy", value_type: "str" },
    { path: "/forecast/0/day", display_path: "forecast[0].day", preview: "Friday", value_type: "str" },
    { path: "/forecast/0/high", display_path: "forecast[0].high", preview: "16", value_type: "int" },
  ],
};

async function mountPanel(page, { lifecycle = false } = {}) {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  if (lifecycle) await page.addScriptTag({ path: LIFECYCLE_SCRIPT });
  await page.addScriptTag({ path: SETUP_UX_SCRIPT });
  await page.addScriptTag({ path: JSON_UX_SCRIPT });

  await page.evaluate(({ previewData, lifecycleMode }) => {
    window.__messages = [];
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__messages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") {
          return { sources: lifecycleMode ? [{
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
            last_successful_update: "2026-09-18T19:00:00+00:00",
          }] : [] };
        }
        if (message.type === "web_data_assistant/preview_json") return previewData;
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
              key: "weather",
              name: "Weather",
              path: "/current/temperature",
              value_type: "number",
              unit: "°C",
              device_class: "temperature",
              state_class: "measurement",
              attributes: {
                humidity: "/current/humidity",
                weather: "/current/weather",
              },
            }],
          };
        }
        if (message.type === "web_data_assistant/create_source") return { entry_id: "created" };
        if (message.type === "web_data_assistant/update_source") return {
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
          last_successful_update: "2026-09-18T19:01:00+00:00",
        };
        throw new Error(`Unexpected call: ${message.type}`);
      },
    };
  }, { previewData: preview, lifecycleMode: lifecycle });
}

test("a nested object can become attributes with one direct scalar as state", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByLabel("Source name").fill("Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();

  const currentBranch = shadow.locator(".json-tree-branch").filter({ hasText: "current" }).first();
  await currentBranch.getByRole("button", { name: "Use as attribute group" }).click();

  await expect(shadow.getByLabel("Object to import")).toHaveValue("/current");
  await expect(shadow.getByText("weather", { exact: true })).toBeVisible();
  await shadow.locator('.json-object-state[value="/current/temperature"]').check();
  await shadow.getByLabel("State unit (optional)").fill("°C");
  await shadow.getByLabel("State unit (optional)").blur();

  const previewCard = shadow.locator(".ha-create-preview");
  await expect(previewCard).toContainText("14.6");
  await expect(previewCard).toContainText("humidity");
  await expect(previewCard).toContainText("82");
  await expect(previewCard).toContainText("weather");
  await expect(previewCard).toContainText("{'condition': 'Cloudy'}");

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();

  const create = await page.evaluate(() =>
    window.__messages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(create.entities).toEqual([{
    key: "weather",
    name: "Weather",
    value_type: "number",
    attributes: {
      humidity: "/current/humidity",
      weather: "/current/weather",
    },
    path: "/current/temperature",
    unit: "°C",
    device_class: "temperature",
    state_class: "measurement",
  }]);
});

test("Edit reconstructs a nested object import and preserves its stable key", async ({ page }) => {
  await mountPanel(page, { lifecycle: true });
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.locator(".source-card").filter({ hasText: "Weather" }).getByRole("button", { name: "Edit" }).click();

  await expect(shadow.getByLabel("Object to import")).toHaveValue("/current");
  await expect(shadow.locator('.json-object-state[value="/current/temperature"]')).toBeChecked();
  await expect(shadow.getByLabel("State unit (optional)")).toHaveValue("°C");
  await expect(shadow.getByLabel("Home Assistant type")).toHaveValue("temperature");
  await expect(shadow.getByLabel("Statistics behavior")).toHaveValue("measurement");
  await expect(shadow.locator(".ha-create-preview")).toContainText("Stable entity key: weather");

  await shadow.getByRole("button", { name: "Save changes" }).click();
  const update = await page.evaluate(() =>
    window.__messages.find((message) => message.type === "web_data_assistant/update_source")
  );
  expect(update.entities[0]).toMatchObject({
    key: "weather",
    path: "/current/temperature",
    attributes: {
      humidity: "/current/humidity",
      weather: "/current/weather",
    },
    device_class: "temperature",
    state_class: "measurement",
  });
});
