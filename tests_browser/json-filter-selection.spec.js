const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("JSON filtering preserves selections hidden by the filter", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate(() => {
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        if (message.type === "web_data_assistant/preview_json") {
          return {
            status: 200,
            content_type: "application/json",
            truncated: false,
            values: [
              { path: "/temperature", display_path: "temperature", preview: "14.6", value_type: "float" },
              { path: "/humidity", display_path: "humidity", preview: "82", value_type: "int" },
            ],
          };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByLabel("Source name").fill("Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load source" }).click();

  const temperatureRow = shadow.locator(".json-row").filter({ hasText: "temperature" });
  await temperatureRow.locator("input[type=checkbox]").check();
  const review = shadow.locator(".sensor-review-row").filter({ hasText: "temperature" });
  await review.getByLabel("Sensor name").fill("Outdoor Temperature");
  await review.getByLabel("Unit (optional)").fill("°C");

  await shadow.locator("#json-filter").fill("humidity");
  await expect(shadow.locator(".json-row")).toHaveCount(1);
  await expect(shadow.locator(".json-row").filter({ hasText: "humidity" })).toBeVisible();
  await expect(shadow.getByText("1 value selected.")).toBeVisible();
  await expect(shadow.locator(".sensor-review-row").filter({ hasText: "temperature" }).getByLabel("Sensor name")).toHaveValue("Outdoor Temperature");

  await shadow.locator("#json-filter").fill("");
  const restoredTemperature = shadow.locator(".json-row").filter({ hasText: "temperature" });
  await expect(restoredTemperature.locator("input[type=checkbox]")).toBeChecked();
  await expect(shadow.locator(".sensor-review-row").filter({ hasText: "temperature" }).getByLabel("Unit (optional)")).toHaveValue("°C");
  await expect(shadow.getByRole("button", { name: "Create in Home Assistant" })).toBeEnabled();
});
