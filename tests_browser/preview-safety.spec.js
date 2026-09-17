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
    window.__wdaPreviewScriptRan = false;
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        if (message.type === "web_data_assistant/preview_html") {
          return {
            status: 200,
            content_type: "text/html",
            html: `<!doctype html><html><body>
              <script>parent.__wdaPreviewScriptRan = true;</script>
              <form id="unsafe-form" action="https://example.invalid/leak" method="post">
                <input name="secret" value="should-not-submit">
                <button type="submit">Submit</button>
              </form>
              <span data-wda-preview-id="value">Safe visible value</span>
            </body></html>`,
            elements: {
              value: { selector: "span", index: 0, text: "Safe visible value", context: "Safe visible value", tag: "span" },
            },
          };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });
}

test("scrape preview remains sandboxed against scripts and form navigation", async ({ page }) => {
  const externalRequests = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://example.invalid/")) externalRequests.push(request.url());
  });

  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByRole("button", { name: /Web page/ }).click();
  await shadow.getByLabel("Source name").fill("Safety fixture");
  await shadow.getByLabel("URL").fill("https://example.test/safety");
  await shadow.getByRole("button", { name: "Load source" }).click();

  const iframe = shadow.locator("#preview");
  await expect(iframe).toHaveAttribute("sandbox", "allow-same-origin");
  const frame = iframe.contentFrame();
  await expect(frame.getByText("Safe visible value")).toBeVisible();

  expect(await page.evaluate(() => window.__wdaPreviewScriptRan)).toBe(false);
  await frame.locator("#unsafe-form").evaluate((form) => form.requestSubmit());
  await page.waitForTimeout(50);

  expect(await page.evaluate(() => window.__wdaPreviewScriptRan)).toBe(false);
  expect(externalRequests).toEqual([]);
});
