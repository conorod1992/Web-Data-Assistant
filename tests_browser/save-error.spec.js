const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("failed source creation preserves the user's configured JSON selection", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
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
            values: [
              {
                path: "/temperature",
                display_path: "temperature",
                preview: "14.6",
                value_type: "float",
              },
            ],
          };
        }
        if (message.type === "web_data_assistant/create_source") {
          throw new Error("Home Assistant rejected the source");
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByLabel("Source name").fill("Carlow Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();
  await shadow.locator(".json-row").filter({ hasText: "temperature" }).locator("input[type=checkbox]").check();

  const review = shadow.locator(".sensor-review-row").filter({ hasText: "temperature" });
  await review.getByLabel("Sensor name").fill("Outdoor Temperature");
  await review.getByLabel("Unit (optional)").fill("°C");

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();

  await expect(shadow.locator(".error")).toContainText("Home Assistant rejected the source");
  await expect(shadow.getByLabel("Source name")).toHaveValue("Carlow Weather");
  await expect(shadow.getByLabel("URL")).toHaveValue("https://example.test/weather.json");
  await expect(shadow.locator(".json-row").filter({ hasText: "temperature" }).locator("input[type=checkbox]")).toBeChecked();
  await expect(shadow.locator(".sensor-review-row").filter({ hasText: "temperature" }).getByLabel("Sensor name")).toHaveValue("Outdoor Temperature");
  await expect(shadow.locator(".sensor-review-row").filter({ hasText: "temperature" }).getByLabel("Unit (optional)")).toHaveValue("°C");
  await expect(shadow.getByRole("button", { name: "Create in Home Assistant" })).toBeEnabled();
});
