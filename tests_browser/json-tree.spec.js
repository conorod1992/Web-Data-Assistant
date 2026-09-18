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

test("hierarchical JSON browser preserves nested selection and search behavior", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.addScriptTag({ path: SETUP_UX_SCRIPT });
  await page.addScriptTag({ path: JSON_UX_SCRIPT });
  await page.evaluate(() => {
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
              { name: "current", path: "/current", preview: "{...}", value_type: "dict" },
              { name: "forecast", path: "/forecast", preview: "[...]", value_type: "list" },
            ],
            values: [
              { path: "/current/temperature", display_path: "current.temperature", preview: "14.6", value_type: "float" },
              { path: "/current/humidity", display_path: "current.humidity", preview: "82", value_type: "int" },
              { path: "/forecast/0/condition", display_path: "forecast[0].condition", preview: "Rain", value_type: "str" },
              { path: "/forecast/0/high", display_path: "forecast[0].high", preview: "16", value_type: "int" },
            ],
          };
        }
        if (message.type === "web_data_assistant/create_source") return { entry_id: "entry-tree" };
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByLabel("Source name").fill("Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();

  const tree = shadow.locator(".json-tree");
  await expect(tree).toBeVisible();
  await expect(tree.locator("summary").filter({ hasText: "current" })).toBeVisible();
  await expect(tree.locator("summary").filter({ hasText: "forecast" })).toBeVisible();

  const forecast = tree.locator("details").filter({ hasText: "forecast" }).first();
  await expect(forecast).toHaveAttribute("open", "");
  const indexZero = forecast.locator("details").filter({ hasText: "[0]" }).first();
  await indexZero.locator("summary").click();

  const condition = tree.locator('.json-check[data-path="/forecast/0/condition"]');
  await condition.check();
  await expect(condition).toBeChecked();
  await expect(shadow.getByText("1 value selected.")).toBeVisible();

  await shadow.locator("#json-filter").fill("temperature");
  await expect(shadow.locator(".json-tree")).toHaveCount(0);
  await expect(shadow.locator(".json-row")).toHaveCount(1);
  await expect(shadow.locator(".json-row").filter({ hasText: "current.temperature" })).toBeVisible();
  await expect(shadow.getByText("1 value selected.")).toBeVisible();

  await shadow.locator("#json-filter").fill("");
  await expect(shadow.locator(".json-tree")).toBeVisible();
  await expect(shadow.locator('.json-check[data-path="/forecast/0/condition"]')).toBeChecked();

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();
  const create = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(create.entities).toEqual([
    {
      key: "forecast_0_condition",
      name: "Condition",
      path: "/forecast/0/condition",
      value_type: "text",
    },
  ]);
});
