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
              { path: "/value", display_path: "value", preview: "42", value_type: "int" },
            ],
          };
        }
        if (message.type === "web_data_assistant/create_source") return { entry_id: "entry-options" };
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });
}

test("advanced request and keep-last options are preserved in the create payload", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByLabel("Source name").fill("Authenticated API");
  await shadow.getByLabel("URL").fill("https://example.test/data");
  await shadow.getByText("Advanced request settings", { exact: true }).click();
  await shadow.getByLabel("Request method").selectOption("POST");
  await shadow.getByLabel("Headers (JSON object)").fill('{"Authorization":"Bearer test-token","X-Mode":"browser"}');
  await shadow.getByLabel("Request body").fill('{"query":"current"}');
  await shadow.getByLabel("Verify SSL certificate").uncheck();

  await shadow.getByLabel("Update interval (minutes)").fill("17");
  await shadow.getByLabel("If the source cannot be reached").selectOption("keep_last");
  await shadow.getByLabel("Maximum age of retained value (minutes)").fill("60");

  await shadow.getByRole("button", { name: "Load source" }).click();
  await shadow.locator(".json-row").filter({ hasText: "value" }).locator("input[type=checkbox]").check();
  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();

  const previewMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/preview_json")
  );
  expect(previewMessage).toMatchObject({
    url: "https://example.test/data",
    method: "POST",
    headers: { Authorization: "Bearer test-token", "X-Mode": "browser" },
    payload: '{"query":"current"}',
    verify_ssl: false,
  });

  const createMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(createMessage).toMatchObject({
    source_name: "Authenticated API",
    source_type: "json",
    scan_interval: 17,
    failure_mode: "keep_last",
    max_stale_minutes: 60,
    url: "https://example.test/data",
    method: "POST",
    headers: { Authorization: "Bearer test-token", "X-Mode": "browser" },
    payload: '{"query":"current"}',
    verify_ssl: false,
  });
});
