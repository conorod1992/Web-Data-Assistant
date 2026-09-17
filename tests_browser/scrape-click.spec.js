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

test("guided scrape workflow selects a value by clicking the page preview", async ({ page }) => {
  await mountPanel(page, {
    "web_data_assistant/preview_html": {
      status: 200,
      content_type: "text/html",
      html: '<!doctype html><html><body><main><h1>Weather</h1><p>Carlow</p><span class="temperature" data-wda-preview-id="temp">14.6 °C</span></main></body></html>',
      elements: {
        temp: {
          selector: ".temperature",
          index: 0,
          text: "14.6 °C",
          context: "Carlow 14.6 °C",
          tag: "span",
        },
      },
    },
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByRole("button", { name: /Web page/ }).click();
  await shadow.getByLabel("Source name").fill("Carlow Temperature");
  await shadow.getByLabel("URL").fill("https://example.test/weather");
  await shadow.getByRole("button", { name: "Load source" }).click();
  await expect(shadow.getByText("Page loaded. Click a value or search for its current text.")).toBeVisible();

  const frame = shadow.locator("#preview").contentFrame();
  await frame.locator(".temperature").click();

  await expect(shadow.getByRole("heading", { name: "Selected value" })).toBeVisible();
  await expect(shadow.getByText("14.6 °C", { exact: true })).toBeVisible();
  await shadow.getByLabel("Unit (optional)").fill("°C");

  const createButton = shadow.getByRole("button", { name: "Create in Home Assistant" });
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect(shadow.getByText("Created Carlow Temperature successfully.")).toBeVisible();

  const createMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(createMessage.source_name).toBe("Carlow Temperature");
  expect(createMessage.source_type).toBe("scrape");
  expect(createMessage.entities).toEqual([
    {
      key: "carlow_temperature",
      name: "Carlow Temperature",
      selector: ".temperature",
      index: 0,
      value_type: "text",
      unit: "°C",
    },
  ]);
});
