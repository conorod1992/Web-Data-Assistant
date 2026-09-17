const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("source-list failure does not block creating a new source", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate(() => {
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        if (message.type === "web_data_assistant/list_sources") {
          throw new Error("Configured sources could not be loaded from Home Assistant");
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await expect(shadow.locator(".error")).toContainText("Configured sources could not be loaded from Home Assistant");

  await expect(shadow.getByRole("heading", { name: "Create a source", level: 2 })).toBeVisible();
  await expect(shadow.getByLabel("Source name")).toBeEnabled();
  await expect(shadow.getByLabel("URL")).toBeEnabled();
  await expect(shadow.getByRole("button", { name: "Load source" })).toBeEnabled();

  await shadow.getByLabel("Source name").fill("Still Usable");
  await shadow.getByLabel("URL").fill("https://example.test/data");
  await expect(shadow.getByLabel("Source name")).toHaveValue("Still Usable");
  await expect(shadow.getByLabel("URL")).toHaveValue("https://example.test/data");
});
