const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("source load failure is shown without losing entered configuration", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate(() => {
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        if (message.type === "web_data_assistant/preview_json") {
          throw new Error("Source returned HTTP 503");
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const name = shadow.getByLabel("Source name");
  const url = shadow.getByLabel("URL");
  await name.fill("Temporary outage");
  await url.fill("https://example.test/unavailable");
  await shadow.getByRole("button", { name: "Load source" }).click();

  await expect(shadow.locator(".error")).toContainText("Source returned HTTP 503");
  await expect(name).toHaveValue("Temporary outage");
  await expect(url).toHaveValue("https://example.test/unavailable");
  await expect(shadow.getByRole("button", { name: "Load source" })).toBeEnabled();
});
