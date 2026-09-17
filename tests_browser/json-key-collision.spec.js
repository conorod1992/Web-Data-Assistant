const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("different JSON paths that slugify alike receive unique entity keys", async ({ page }) => {
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
              { path: "/a-b", display_path: "a-b", preview: "1", value_type: "int" },
              { path: "/a_b", display_path: "a_b", preview: "2", value_type: "int" },
            ],
          };
        }
        if (message.type === "web_data_assistant/create_source") return { entry_id: "entry-1" };
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByLabel("Source name").fill("Collision Test");
  await shadow.getByLabel("URL").fill("https://example.test/data.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();
  await shadow.locator(".json-row").filter({ hasText: "a-b" }).locator("input[type=checkbox]").check();
  await shadow.locator(".json-row").filter({ hasText: "a_b" }).locator("input[type=checkbox]").check();
  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();

  const create = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(create.entities.map((entity) => entity.key)).toEqual(["a_b", "a_b_2"]);
});
