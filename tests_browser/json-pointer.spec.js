const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("guided JSON selection preserves escaped RFC 6901 paths", async ({ page }) => {
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
                path: "/weather~1current/temp~0value",
                display_path: 'weather/current["temp~value"]',
                preview: "14.6",
                value_type: "float",
              },
            ],
          };
        }
        if (message.type === "web_data_assistant/create_source") return { entry_id: "escaped" };
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByLabel("Source name").fill("Escaped JSON");
  await shadow.getByLabel("URL").fill("https://example.test/escaped.json");
  await shadow.getByRole("button", { name: "Load source" }).click();
  await shadow.locator(".json-row").locator("input[type=checkbox]").check();
  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();

  const createMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(createMessage.entities).toHaveLength(1);
  expect(createMessage.entities[0].path).toBe("/weather~1current/temp~0value");
});
