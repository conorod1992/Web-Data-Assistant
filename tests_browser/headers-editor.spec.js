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

async function mountPanel(page) {
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
          return { status: 200, content_type: "application/json", truncated: false, root_type: "dict", root_fields: [], values: [] };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });
}

test("friendly header rows can be added and removed without collapsing advanced settings", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByLabel("Source name").fill("Headers");
  await shadow.getByLabel("URL").fill("https://example.test/data");
  await shadow.getByText("Advanced request settings", { exact: true }).click();

  const advanced = shadow.locator("details").filter({ hasText: "Advanced request settings" }).first();
  await expect(advanced).toHaveAttribute("open", "");

  await shadow.getByRole("button", { name: "Add header" }).click();
  await expect(advanced).toHaveAttribute("open", "");
  await shadow.getByLabel("Header name 1").fill("Authorization");
  await shadow.getByLabel("Header value 1").fill("Bearer token");

  await shadow.getByRole("button", { name: "Add header" }).click();
  await expect(shadow.getByLabel("Header name 2")).toBeVisible();
  await shadow.getByLabel("Header name 2").fill("X-Mode");
  await shadow.getByLabel("Header value 2").fill("browser");

  await shadow.locator(".header-row").first().getByRole("button", { name: "Remove" }).click();
  await expect(advanced).toHaveAttribute("open", "");
  await expect(shadow.getByLabel("Header name 1")).toHaveValue("X-Mode");
  await expect(shadow.getByLabel("Header value 1")).toHaveValue("browser");

  await shadow.getByRole("button", { name: "Load JSON" }).click();

  const message = await page.evaluate(() =>
    window.__webDataMessages.find((item) => item.type === "web_data_assistant/preview_json")
  );
  expect(message.headers).toEqual({ "X-Mode": "browser" });
});

test("duplicate header names are rejected case-insensitively before a request", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");

  await shadow.getByLabel("Source name").fill("Headers");
  await shadow.getByLabel("URL").fill("https://example.test/data");
  await shadow.getByText("Advanced request settings", { exact: true }).click();

  await shadow.getByRole("button", { name: "Add header" }).click();
  await shadow.getByLabel("Header name 1").fill("X-Test");
  await shadow.getByLabel("Header value 1").fill("one");
  await shadow.getByRole("button", { name: "Add header" }).click();
  await shadow.getByLabel("Header name 2").fill("x-test");
  await shadow.getByLabel("Header value 2").fill("two");

  await shadow.getByRole("button", { name: "Load JSON" }).click();

  await expect(shadow.locator(".notice.error")).toContainText("Header names must be unique.");
  const previewCalls = await page.evaluate(() =>
    window.__webDataMessages.filter((item) => item.type === "web_data_assistant/preview_json")
  );
  expect(previewCalls).toEqual([]);
});
