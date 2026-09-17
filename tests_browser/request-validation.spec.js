const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("invalid headers JSON is rejected before a preview request is sent", async ({ page }) => {
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
  await shadow.getByLabel("Source name").fill("Broken headers");
  await shadow.getByLabel("URL").fill("https://example.test/data");
  await shadow.getByText("Advanced request settings", { exact: true }).click();
  await shadow.getByLabel("Headers (JSON object)").fill('{"Authorization":');
  await shadow.getByRole("button", { name: "Load JSON" }).click();

  await expect(shadow.locator(".error")).toContainText("Headers must be a valid JSON object.");
  const previewCalls = await page.evaluate(() =>
    window.__webDataMessages.filter((message) => message.type === "web_data_assistant/preview_json")
  );
  expect(previewCalls).toEqual([]);
});
