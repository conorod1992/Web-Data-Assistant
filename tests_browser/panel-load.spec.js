const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

async function mountPanel(page) {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate(() => {
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      connection: {
        sendMessagePromise: async (message) => {
          if (message.type === "web_data_assistant/list_sources") {
            return { sources: [] };
          }
          throw new Error(`Unexpected WebSocket call: ${message.type}`);
        },
      },
    };
  });
}

test("panel loads cleanly in Chromium", async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await mountPanel(page);

  const panel = page.locator("web-data-assistant-panel");
  const shadow = panel.locator(":scope");
  await expect(shadow.getByRole("heading", { name: "Web Data Assistant", level: 1 })).toBeVisible();
  await expect(shadow.getByRole("heading", { name: "Create a source", level: 2 })).toBeVisible();
  await expect(shadow.getByRole("button", { name: "Load source" })).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
