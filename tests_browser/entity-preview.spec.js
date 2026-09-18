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

async function mountPanel(page, { scrape = false } = {}) {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.addScriptTag({ path: SETUP_UX_SCRIPT });
  await page.evaluate(({ scrapeMode }) => {
    window.__webDataMessages = [];
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__webDataMessages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        if (message.type === "web_data_assistant/preview_json") {
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
        if (message.type === "web_data_assistant/search_html") {
          return {
            matches: [{
              selector: ".temperature",
              index: 0,
              text: "14°C",
              context: "Carlow current temperature 14°C",
              tag: "span",
            }],
          };
        }
        if (message.type === "web_data_assistant/create_source") return { entry_id: scrapeMode ? "scrape-entry" : "json-entry" };
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  }, { scrapeMode: scrape });
}

test("preview mirrors separate JSON sensor definitions and updates live", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByLabel("Source name").fill("Weather API");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();

  await shadow.locator(".json-row").filter({ hasText: "temperature" }).locator("input[type=checkbox]").check();
  await shadow.locator(".json-row").filter({ hasText: "humidity" }).locator("input[type=checkbox]").check();

  await shadow.locator('.json-unit[data-path="/temperature"]').fill("°C");
  await shadow.locator('.json-name[data-path="/humidity"]').fill("Relative Humidity");
  await shadow.locator('.json-unit[data-path="/humidity"]').fill("%");

  const preview = shadow.locator(".ha-create-preview");
  await expect(preview.getByRole("heading", { name: "What Home Assistant will create" })).toBeVisible();
  await expect(preview.locator(".ha-preview-entity")).toHaveCount(2);

  const temperature = preview.locator(".ha-preview-entity").filter({ hasText: "Temperature" });
  await expect(temperature).toContainText("14.6");
  await expect(temperature).toContainText("°C");
  await expect(temperature).toContainText("Stable entity key: temperature");

  const humidity = preview.locator(".ha-preview-entity").filter({ hasText: "Relative Humidity" });
  await expect(humidity).toContainText("82");
  await expect(humidity).toContainText("%");

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();

  const message = await page.evaluate(() =>
    window.__webDataMessages.find((item) => item.type === "web_data_assistant/create_source")
  );
  expect(message.entities).toEqual([
    {
      key: "temperature",
      name: "Temperature",
      path: "/temperature",
      value_type: "number",
      unit: "°C",
    },
    {
      key: "humidity",
      name: "Relative Humidity",
      path: "/humidity",
      value_type: "number",
      unit: "%",
    },
  ]);
});

test("preview shows aggregate JSON state and attributes", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByLabel("Source name").fill("Weather Summary");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();

  await shadow.getByRole("button", { name: /One sensor \+ attributes/ }).click();
  await shadow.locator(".json-row").filter({ hasText: "temperature" }).locator("input[type=checkbox]").check();
  await shadow.locator(".json-row").filter({ hasText: "humidity" }).locator("input[type=checkbox]").check();
  await shadow.locator('.json-state[value="/temperature"]').check();
  await shadow.getByLabel("State unit (optional)").fill("°C");

  const preview = shadow.locator(".ha-create-preview");
  await expect(preview.locator(".ha-preview-entity")).toHaveCount(1);
  await expect(preview).toContainText("Weather Summary");
  await expect(preview).toContainText("14.6");
  await expect(preview).toContainText("°C");
  await expect(preview).toContainText("1 attribute");
  await expect(preview).toContainText("humidity");
  await expect(preview).toContainText("82");

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();
  const message = await page.evaluate(() =>
    window.__webDataMessages.find((item) => item.type === "web_data_assistant/create_source")
  );
  expect(message.entities).toEqual([
    {
      key: "weather_summary",
      name: "Weather Summary",
      value_type: "number",
      attributes: { humidity: "/humidity" },
      path: "/temperature",
      unit: "°C",
    },
  ]);
});

test("preview shows current scraped value from the same entity payload", async ({ page }) => {
  await mountPanel(page, { scrape: true });
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByRole("button", { name: /Web page/ }).click();
  await shadow.getByLabel("Source name").fill("Carlow Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather");
  await shadow.getByLabel("Current text or value").fill("14°C");
  await shadow.getByRole("button", { name: "Find matches" }).click();
  await shadow.getByLabel("New sensor name").fill("Temperature");
  await shadow.getByLabel("New sensor unit (optional)").fill("°C");
  await shadow.getByRole("button", { name: "Add sensor" }).click();

  const preview = shadow.locator(".ha-create-preview");
  await expect(preview.locator(".ha-preview-entity")).toHaveCount(1);
  await expect(preview).toContainText("Temperature");
  await expect(preview).toContainText("14°C");
  await expect(preview).toContainText("Stable entity key: temperature");

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();
  const message = await page.evaluate(() =>
    window.__webDataMessages.find((item) => item.type === "web_data_assistant/create_source")
  );
  expect(message.entities).toEqual([
    {
      key: "temperature",
      name: "Temperature",
      selector: ".temperature",
      index: 0,
      value_type: "text",
      unit: "°C",
    },
  ]);
});
