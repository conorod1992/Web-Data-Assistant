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

test("advanced request headers normalize scalar values to strings", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.addScriptTag({ path: SETUP_UX_SCRIPT });
  await page.evaluate(() => {
    window.__webDataMessages = [];
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__webDataMessages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        if (message.type === "web_data_assistant/preview_json") {
          return { status: 200, content_type: "application/json", truncated: false, values: [] };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByLabel("Source name").fill("Headers");
  await shadow.getByLabel("URL").fill("https://example.test/data");
  await shadow.getByText("Advanced request settings", { exact: true }).click();
  await shadow.getByText("Raw headers JSON", { exact: true }).click();
  await shadow.getByLabel("Raw headers JSON").fill('{"X-Retry":3,"X-Enabled":true,"X-Null":null}');
  await shadow.getByRole("button", { name: "Apply JSON" }).click();

  await expect(shadow.getByLabel("Header value 1")).toHaveValue("3");
  await expect(shadow.getByLabel("Header value 2")).toHaveValue("true");
  await expect(shadow.getByLabel("Header value 3")).toHaveValue("null");
  await shadow.getByRole("button", { name: "Load JSON" }).click();

  await expect(shadow.getByText("Loaded 0 selectable JSON values.")).toBeVisible();
  const preview = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/preview_json")
  );
  expect(preview.headers).toEqual({
    "X-Retry": "3",
    "X-Enabled": "true",
    "X-Null": "null",
  });
});
