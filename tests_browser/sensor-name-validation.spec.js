const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("selected JSON sensors require a non-empty friendly name before save", async ({ page }) => {
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
  await shadow.locator(".json-row").filter({ hasText: "temperature" }).locator("input[type=checkbox]").check();

  const name = shadow.locator(".sensor-review-row").filter({ hasText: "temperature" }).getByLabel("Sensor name");
  const create = shadow.getByRole("button", { name: "Create in Home Assistant" });
  await expect(create).toBeEnabled();

  await name.fill("   ");
  await expect(create).toBeDisabled();

  await name.fill("Outdoor Temperature");
  await expect(create).toBeEnabled();
});
