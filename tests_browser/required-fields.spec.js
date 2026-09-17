const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("loading JSON requires both source name and URL before any request", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate(() => {
    window.__webDataMessages = [];
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__webDataMessages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByRole("button", { name: "Load JSON" }).click();
  await expect(shadow.locator(".error")).toContainText("Enter a source name and URL first.");

  await shadow.getByLabel("Source name").fill("Only a name");
  await shadow.getByRole("button", { name: "Load JSON" }).click();
  await expect(shadow.locator(".error")).toContainText("Enter a source name and URL first.");

  const previewCalls = await page.evaluate(() =>
    window.__webDataMessages.filter((message) =>
      message.type === "web_data_assistant/preview_json" ||
      message.type === "web_data_assistant/search_html"
    )
  );
  expect(previewCalls).toEqual([]);
});
