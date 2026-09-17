const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

async function mountPanel(page, responses = {}) {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate((configuredResponses) => {
    window.__webDataMessages = [];
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__webDataMessages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        if (message.type === "web_data_assistant/create_source") return { entry_id: "entry-scrape" };
        if (Object.hasOwn(configuredResponses, message.type)) return configuredResponses[message.type];
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  }, responses);
}

test("guided scrape text search disambiguates multiple visible matches", async ({ page }) => {
  await mountPanel(page, {
    "web_data_assistant/preview_html": {
      status: 200,
      content_type: "text/html",
      html: '<!doctype html><html><body><section><span data-wda-preview-id="current">14°C</span></section><section><span data-wda-preview-id="historic">14°C</span></section></body></html>',
      elements: {},
    },
    "web_data_assistant/search_html": {
      matches: [
        {
          selector: ".current-temperature",
          index: 0,
          text: "14°C",
          context: "Carlow current weather 14°C",
          tag: "span",
        },
        {
          selector: ".historic-temperature",
          index: 0,
          text: "14°C",
          context: "Yesterday at 13:00 14°C",
          tag: "span",
        },
      ],
    },
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByRole("button", { name: /Web page/ }).click();
  await shadow.getByLabel("Source name").fill("Carlow Current Temperature");
  await shadow.getByLabel("URL").fill("https://example.test/weather");
  await shadow.getByRole("button", { name: "Load source" }).click();

  await shadow.getByLabel("Current text or value").fill("14°C");
  await shadow.getByRole("button", { name: "Find text" }).click();
  await expect(shadow.getByText("2 specific matches found.")).toBeVisible();
  await expect(shadow.getByText("Carlow current weather 14°C")).toBeVisible();
  await expect(shadow.getByText("Yesterday at 13:00 14°C")).toBeVisible();

  await shadow.locator(".match").filter({ hasText: "Carlow current weather 14°C" }).click();
  await expect(shadow.getByRole("heading", { name: "Selected value" })).toBeVisible();

  const createButton = shadow.getByRole("button", { name: "Create in Home Assistant" });
  await expect(createButton).toBeEnabled();
  await createButton.click();

  const searchMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/search_html")
  );
  expect(searchMessage.search_text).toBe("14°C");

  const createMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(createMessage.entities).toEqual([
    {
      key: "carlow_current_temperature",
      name: "Carlow Current Temperature",
      selector: ".current-temperature",
      index: 0,
      value_type: "text",
    },
  ]);
});
