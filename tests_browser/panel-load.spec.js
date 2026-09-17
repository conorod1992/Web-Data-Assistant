const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

async function mountPanel(page, responses = {}) {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate((configuredResponses) => {
    window.__webDataMessages = [];
    window.__webDataCreated = false;
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__webDataMessages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") {
          if (window.__webDataCreated && configuredResponses.createdSources) {
            return configuredResponses.createdSources;
          }
          return { sources: [] };
        }
        if (message.type === "web_data_assistant/create_source") {
          window.__webDataCreated = true;
          return { entry_id: "entry-1" };
        }
        if (Object.hasOwn(configuredResponses, message.type)) {
          return configuredResponses[message.type];
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  }, responses);
}

const JSON_PREVIEW = {
  status: 200,
  content_type: "application/json",
  truncated: false,
  root_type: "dict",
  root_fields: [
    { name: "current", path: "/current", preview: "[object Object]", value_type: "dict" },
    { name: "forecast", path: "/forecast", preview: "[object Object],[object Object]", value_type: "list" },
  ],
  values: [
    { path: "/current/temperature", display_path: "current.temperature", preview: "14.6", value_type: "float" },
    { path: "/current/humidity", display_path: "current.humidity", preview: "82", value_type: "int" },
    { path: "/current/condition", display_path: "current.condition", preview: "Cloudy", value_type: "str" },
  ],
};

test("panel loads cleanly in Chromium", async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await mountPanel(page);

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await expect(shadow.getByRole("heading", { name: "Web Data Assistant", level: 1 })).toBeVisible();
  await expect(shadow.getByRole("heading", { name: "Configured sources", level: 2 })).toBeVisible();
  await expect(shadow.getByText("No Web Data Assistant sources have been created yet.")).toBeVisible();
  await expect(shadow.getByRole("heading", { name: "1. Source", level: 2 })).toBeVisible();
  await expect(shadow.getByRole("button", { name: "Load JSON" })).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("guided JSON workflow saves selected values as separate sensors", async ({ page }) => {
  await mountPanel(page, {
    "web_data_assistant/preview_json": JSON_PREVIEW,
    createdSources: {
      sources: [{
        entry_id: "entry-1", title: "Carlow Weather", source_type: "json",
        url: "https://example.test/weather.json", entity_count: 2, scan_interval: 5,
        failure_mode: "unavailable", source_available: true, extraction_error_count: 0,
        last_successful_update: "2026-09-17T17:00:00+00:00", state: "loaded",
      }],
    },
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByLabel("Source name").fill("Carlow Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();
  await expect(shadow.getByText("Loaded 3 selectable JSON values.")).toBeVisible();

  await shadow.locator(".json-row").filter({ hasText: "current.temperature" }).locator("input[type=checkbox]").check();
  await shadow.locator(".json-row").filter({ hasText: "current.humidity" }).locator("input[type=checkbox]").check();

  const temperatureReview = shadow.locator(".sensor-review-row").filter({ hasText: "current.temperature" });
  const humidityReview = shadow.locator(".sensor-review-row").filter({ hasText: "current.humidity" });
  await temperatureReview.getByLabel("Sensor name").fill("Outdoor Temperature");
  await temperatureReview.getByLabel("Unit (optional)").fill("°C");
  await humidityReview.getByLabel("Sensor name").fill("Relative Humidity");
  await humidityReview.getByLabel("Unit (optional)").fill("%");

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();
  await expect(shadow.getByText("Created Carlow Weather successfully.")).toBeVisible();

  const createMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(createMessage.entities).toEqual([
    { key: "current_temperature", name: "Outdoor Temperature", path: "/current/temperature", value_type: "number", unit: "°C" },
    { key: "current_humidity", name: "Relative Humidity", path: "/current/humidity", value_type: "number", unit: "%" },
  ]);
  expect(createMessage.long_text_policy).toBe("truncate");
});

test("one JSON sensor can use one value as state and others as attributes", async ({ page }) => {
  await mountPanel(page, { "web_data_assistant/preview_json": JSON_PREVIEW });
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByLabel("Source name").fill("Carlow Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();
  await shadow.getByRole("button", { name: /One sensor \+ attributes/ }).click();

  for (const pathText of ["current.temperature", "current.humidity", "current.condition"]) {
    await shadow.locator(".json-row").filter({ hasText: pathText }).locator("input[type=checkbox]").check();
  }
  await shadow.getByLabel("current.temperature").check();
  const humidity = shadow.locator(".sensor-review-row").filter({ hasText: "current.humidity" });
  const condition = shadow.locator(".sensor-review-row").filter({ hasText: "current.condition" });
  await humidity.getByLabel("Attribute name").fill("humidity");
  await condition.getByLabel("Attribute name").fill("condition");
  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();

  const createMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(createMessage.entities).toEqual([{
    key: "carlow_weather",
    name: "Carlow Weather",
    value_type: "number",
    path: "/current/temperature",
    attributes: {
      humidity: "/current/humidity",
      condition: "/current/condition",
    },
  }]);
});

test("root JSON object can be imported as structured attributes", async ({ page }) => {
  await mountPanel(page, { "web_data_assistant/preview_json": JSON_PREVIEW });
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByLabel("Source name").fill("Weather document");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();
  await shadow.getByRole("button", { name: /Import object as attributes/ }).click();
  await expect(shadow.getByText(/Nested objects and arrays remain structured/)).toBeVisible();
  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();

  const createMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(createMessage.entities).toEqual([{
    key: "weather_document",
    name: "Weather document",
    value_type: "text",
    attributes: {
      current: "/current",
      forecast: "/forecast",
    },
  }]);
});
