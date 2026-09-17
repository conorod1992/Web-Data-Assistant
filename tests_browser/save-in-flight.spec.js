const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("create action is disabled while source creation is in flight", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate(() => {
    window.__createCalls = 0;
    window.__resolveCreate = null;
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        if (message.type === "web_data_assistant/preview_json") {
          return {
            status: 200,
            content_type: "application/json",
            truncated: false,
            values: [
              { path: "/temperature", display_path: "temperature", preview: "14.6", value_type: "float" },
            ],
          };
        }
        if (message.type === "web_data_assistant/create_source") {
          window.__createCalls += 1;
          return await new Promise((resolve) => { window.__resolveCreate = resolve; });
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByLabel("Source name").fill("Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather.json");
  await shadow.getByRole("button", { name: "Load JSON" }).click();
  await shadow.locator(".json-row").filter({ hasText: "temperature" }).locator("input[type=checkbox]").check();

  const create = shadow.getByRole("button", { name: "Create in Home Assistant" });
  await create.click({ noWaitAfter: true });

  const creating = shadow.getByRole("button", { name: "Creating…" });
  await expect(creating).toBeDisabled();
  await creating.click({ force: true });
  expect(await page.evaluate(() => window.__createCalls)).toBe(1);

  await page.evaluate(() => window.__resolveCreate({ entry_id: "entry-1" }));
  await expect(shadow.getByText("Created Weather successfully.")).toBeVisible();
  expect(await page.evaluate(() => window.__createCalls)).toBe(1);
});
