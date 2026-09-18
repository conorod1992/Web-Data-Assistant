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

test("web scrape workflow opens the real page and does not render an iframe", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByRole("button", { name: /Web page/ }).click();
  await shadow.getByLabel("Source name").fill("Carlow Temperature");
  await shadow.getByLabel("URL").fill("https://example.test/weather");

  const openPage = shadow.getByRole("link", { name: /Open page/ });
  await expect(openPage).toHaveAttribute("href", "https://example.test/weather");
  await expect(openPage).toHaveAttribute("target", "_blank");
  await expect(openPage).toHaveAttribute("rel", /noopener/);
  await expect(shadow.locator("iframe")).toHaveCount(0);
  await expect(shadow.getByText(/Open the real site in another tab/)).toBeVisible();
});

test("guided scrape text search disambiguates multiple visible matches", async ({ page }) => {
  await mountPanel(page, {
    "web_data_assistant/search_html": {
      matches: [
        {
          selector: ".current-temperature",
          index: 0,
          text: "14°C",
          context: "Carlow current weather 14°C Mostly cloudy",
          tag: "span",
        },
        {
          selector: ".historic-temperature",
          index: 0,
          text: "14°C",
          context: "Yesterday at 13:00 14°C Rain",
          tag: "span",
        },
      ],
    },
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByRole("button", { name: /Web page/ }).click();
  await shadow.getByLabel("Source name").fill("Carlow Current Temperature");
  await shadow.getByLabel("URL").fill("https://example.test/weather");
  await shadow.getByLabel("Current text or value").fill("14°C");
  await shadow.getByRole("button", { name: "Find matches" }).click();

  await expect(shadow.getByText("Found 2 specific matches.")).toBeVisible();
  await expect(shadow.getByText("Carlow current weather 14°C Mostly cloudy")).toBeVisible();
  await expect(shadow.getByText("Yesterday at 13:00 14°C Rain")).toBeVisible();

  await shadow.locator(".match").filter({ hasText: "Carlow current weather" }).click();
  await expect(shadow.getByRole("heading", { name: "Add this value as a sensor" })).toBeVisible();
  await shadow.getByLabel("New sensor name").fill("Current Temperature");
  await shadow.getByLabel("New sensor unit (optional)").fill("°C");
  await shadow.getByRole("button", { name: "Add sensor" }).click();

  const createButton = shadow.getByRole("button", { name: "Create in Home Assistant" });
  await expect(createButton).toBeEnabled();
  await createButton.click();

  const messages = await page.evaluate(() => window.__webDataMessages);
  expect(messages.some((message) => message.type === "web_data_assistant/preview_html")).toBe(false);
  const searchMessage = messages.find((message) => message.type === "web_data_assistant/search_html");
  expect(searchMessage.search_text).toBe("14°C");
  expect(searchMessage.url).toBe("https://example.test/weather");

  const createMessage = messages.find((message) => message.type === "web_data_assistant/create_source");
  expect(createMessage.entities).toEqual([
    {
      key: "current_temperature",
      name: "Current Temperature",
      selector: ".current-temperature",
      index: 0,
      value_type: "text",
      unit: "°C",
    },
  ]);
  expect(createMessage.long_text_policy).toBe("truncate");
});

test("no-match scrape search can be retried without reloading a page preview", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate(() => {
    window.__searchCount = 0;
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        if (message.type === "web_data_assistant/search_html") {
          window.__searchCount += 1;
          if (window.__searchCount === 1) return { matches: [] };
          return {
            matches: [{ selector: ".temperature", index: 0, text: "14°C", context: "Carlow 14°C", tag: "span" }],
          };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByRole("button", { name: /Web page/ }).click();
  await shadow.getByLabel("Source name").fill("Carlow Temperature");
  await shadow.getByLabel("URL").fill("https://example.test/weather");

  await shadow.getByLabel("Current text or value").fill("99°C");
  await shadow.getByRole("button", { name: "Find matches" }).click();
  await expect(shadow.getByText(/That text was not found in the page response/)).toBeVisible();
  await expect(shadow.getByRole("button", { name: "Create in Home Assistant" })).toBeDisabled();

  await shadow.getByLabel("Current text or value").fill("14°C");
  await shadow.getByRole("button", { name: "Find matches" }).click();
  await expect(shadow.getByText("Found 1 specific match.")).toBeVisible();
  await expect(shadow.getByRole("heading", { name: "Add this value as a sensor" })).toBeVisible();
  await expect(shadow.getByRole("button", { name: "Create in Home Assistant" })).toBeDisabled();
});

test("empty scrape text search is rejected before a request", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByRole("button", { name: /Web page/ }).click();
  await shadow.getByLabel("Source name").fill("Carlow Temperature");
  await shadow.getByLabel("URL").fill("https://example.test/weather");
  await shadow.getByRole("button", { name: "Find matches" }).click();

  await expect(shadow.locator(".error")).toContainText("Enter the current text or value to find.");
  const searchCalls = await page.evaluate(() =>
    window.__webDataMessages.filter((message) => message.type === "web_data_assistant/search_html")
  );
  expect(searchCalls).toEqual([]);
});


test("multiple scraped values become separate sensors from one source", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate(() => {
    window.__webDataMessages = [];
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__webDataMessages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        if (message.type === "web_data_assistant/search_html") {
          if (message.search_text === "14°C") {
            return { matches: [{ selector: ".temperature", index: 0, text: "14°C", context: "Carlow 14°C", tag: "span" }] };
          }
          if (message.search_text === "82%") {
            return { matches: [{ selector: ".humidity", index: 0, text: "82%", context: "Carlow humidity 82%", tag: "span" }] };
          }
          return { matches: [] };
        }
        if (message.type === "web_data_assistant/create_source") return { entry_id: "multi-scrape" };
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByRole("button", { name: /Web page/ }).click();
  await shadow.getByLabel("Source name").fill("Carlow Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather");

  await shadow.getByLabel("Current text or value").fill("14°C");
  await shadow.getByRole("button", { name: "Find matches" }).click();
  await shadow.getByLabel("New sensor name").fill("Temperature");
  await shadow.getByLabel("New sensor unit (optional)").fill("°C");
  await shadow.getByRole("button", { name: "Add sensor" }).click();

  await expect(shadow.getByText("Values from this page")).toBeVisible();
  await expect(shadow.getByText("Temperature", { exact: true })).toBeVisible();

  await shadow.getByLabel("Current text or value").fill("82%");
  await shadow.getByRole("button", { name: "Find matches" }).click();
  await shadow.getByLabel("New sensor name").fill("Humidity");
  await shadow.getByLabel("New sensor unit (optional)").fill("%");
  await shadow.getByRole("button", { name: "Add sensor" }).click();

  await expect(shadow.getByText("Humidity", { exact: true })).toBeVisible();
  const removeButtons = shadow.getByRole("button", { name: "Remove" });
  await expect(removeButtons).toHaveCount(2);
  await removeButtons.nth(1).click();
  await expect(shadow.getByText("Humidity", { exact: true })).toHaveCount(0);

  await shadow.getByLabel("Current text or value").fill("82%");
  await shadow.getByRole("button", { name: "Find matches" }).click();
  await shadow.getByLabel("New sensor name").fill("Humidity");
  await shadow.getByLabel("New sensor unit (optional)").fill("%");
  await shadow.getByRole("button", { name: "Add sensor" }).click();

  const addedNames = shadow.locator(".scrape-added-name");
  const addedUnits = shadow.locator(".scrape-added-unit");
  await addedNames.nth(1).fill("Relative Humidity");
  await addedUnits.nth(1).fill("% RH");

  await shadow.getByRole("button", { name: "Create in Home Assistant" }).click();

  const createMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/create_source")
  );
  expect(createMessage.url).toBe("https://example.test/weather");
  expect(createMessage.entities).toEqual([
    {
      key: "temperature",
      name: "Temperature",
      selector: ".temperature",
      index: 0,
      value_type: "text",
      unit: "°C",
    },
    {
      key: "relative_humidity",
      name: "Relative Humidity",
      selector: ".humidity",
      index: 0,
      value_type: "text",
      unit: "% RH",
    },
  ]);
});


test("the same scraped page element cannot be added twice", async ({ page }) => {
  await mountPanel(page, {
    "web_data_assistant/search_html": {
      matches: [
        {
          selector: ".temperature",
          index: 0,
          text: "14°C",
          context: "Carlow 14°C",
          tag: "span",
        },
      ],
    },
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await shadow.getByRole("button", { name: /Web page/ }).click();
  await shadow.getByLabel("Source name").fill("Carlow Weather");
  await shadow.getByLabel("URL").fill("https://example.test/weather");

  for (const name of ["Temperature", "Temperature Copy"]) {
    await shadow.getByLabel("Current text or value").fill("14°C");
    await shadow.getByRole("button", { name: "Find matches" }).click();
    await shadow.getByLabel("New sensor name").fill(name);
    await shadow.getByRole("button", { name: "Add sensor" }).click();
  }

  await expect(shadow.locator(".error")).toContainText("That page value has already been added.");
  await expect(shadow.locator(".scrape-value")).toHaveCount(1);
});
