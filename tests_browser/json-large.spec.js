const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

async function mountPanel(page) {
  const values = Array.from({ length: 250 }, (_, index) => ({
    path: `/items/${index}/value`,
    display_path: `items[${index}].value`,
    preview: String(index),
    value_type: "int",
  }));

  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate((candidateValues) => {
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        if (message.type === "web_data_assistant/preview_json") {
          return {
            status: 200,
            content_type: "application/json",
            truncated: true,
            values: candidateValues,
          };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  }, values);
}

test("truncated JSON discovery is explicit and remains filterable", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByLabel("Source name").fill("Large API");
  await shadow.getByLabel("URL").fill("https://example.test/large.json");
  await shadow.getByRole("button", { name: "Load source" }).click();

  await expect(shadow.getByText("Loaded the source. Showing the first 250 selectable JSON values.")).toBeVisible();
  await expect(shadow.getByText(/more than 250 scalar values/i)).toBeVisible();
  await expect(shadow.locator(".json-row")).toHaveCount(250);

  await shadow.locator("#json-filter").fill("items[249]");
  await expect(shadow.locator(".json-row")).toHaveCount(1);
  await expect(shadow.locator(".json-row")).toContainText("items[249].value");
});
