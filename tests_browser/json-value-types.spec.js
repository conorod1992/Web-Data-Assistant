const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("guided JSON maps discovered scalar types to entity value types", async ({ page }) => {
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
              { path: "/online", display_path: "online", preview: "true", value_type: "bool" },
              { path: "/count", display_path: "count", preview: "3", value_type: "int" },
              { path: "/label", display_path: "label", preview: "Ready", value_type: "str" },
            ],
          };
        }
        if (message.type === "web_data_assistant/create_source") return { entry_id: "entry-1" };
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByLabel("Source name").fill("Typed API");
  await shadow.getByLabel("URL").fill("https://example.test/data.json");
  await shadow.getByRole("button", { name: "Load source" }).click();
  for (const label of ["online", "count", "label"]) {
    await shadow.locator(".json-row").filter({ hasText: label }).locator("input[type=checkbox]").check();
  }
  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();

  const create = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(create.entities.map(({ path, value_type }) => ({ path, value_type }))).toEqual([
    { path: "/online", value_type: "boolean" },
    { path: "/count", value_type: "number" },
    { path: "/label", value_type: "text" },
  ]);
});
