const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const FRONTEND = path.resolve(__dirname, "../custom_components/web_data_assistant/frontend");
const PREFIX = "/web_data_assistant/frontend/";
const candidates = [
  { selector: "#weather a", index: 0, match_count: 1, stability: "strong", strategy: "ancestor", reason: "Anchored inside the weather section." },
  { selector: "a", index: 16, match_count: 17, stability: "fragile", strategy: "tag", reason: "Uses document order; inserted links can change the selected value." },
];
const match = { ...candidates[0], text: "14°C", context: "Today · Carlow · 14°C", tag: "a", candidates };

async function mount(page, { existing = false } = {}) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Serve the exact shipped modules. Do not bypass the production entrypoint
  // by manually injecting a subset of feature scripts in a convenient order.
  await page.route("https://wda.test/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" });
    }
    if (pathname.startsWith(PREFIX)) {
      const name = pathname.slice(PREFIX.length);
      if (path.basename(name) === name && name.endsWith(".js") && fs.existsSync(path.join(FRONTEND, name))) {
        return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(FRONTEND, name), "utf8") });
      }
    }
    return route.fulfill({ status: 404, body: "Not found" });
  });
  await page.goto("https://wda.test/");
  await page.evaluate(async ({ fixture, existingSource }) => {
    await import("/web_data_assistant/frontend/web-data-assistant-panel-entry.js");
    window.__messages = [];
    window.__testFailure = false;
    window.__delayTest = false;
    const source = {
      entry_id: "weather", title: "Weather page", state: "loaded", source_type: "scrape",
      url: "https://example.test/weather", entity_count: 1, scan_interval: 5,
      source_available: true, failure_mode: "unavailable", extraction_error_count: 1,
      extraction_issues: [{ key: "temperature", name: "Temperature", error: "Selector no longer matches", repairable: true }],
    };
    const panel = document.createElement("web-data-assistant-panel");
    document.body.append(panel);
    panel.hass = {
      callWS: async (message) => {
        window.__messages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") return { sources: existingSource ? [source] : [] };
        if (message.type === "web_data_assistant/search_html") return { matches: [structuredClone(fixture)] };
        if (message.type === "web_data_assistant/test_html_selector") {
          if (window.__testFailure) throw new Error("Invalid CSS selector. Check its syntax.");
          const result = { selector: message.selector, index: message.index, match_count: 2, text: "19°C", context: "Tomorrow · Carlow · 19°C", tag: "a" };
          if (window.__delayTest) return new Promise((resolve) => { window.__finishTest = () => resolve(result); });
          return result;
        }
        if (message.type === "web_data_assistant/get_source") return {
          source_name: "Weather page", source_type: "scrape", entry_id: "weather", url: source.url,
          entities: [{ key: "temperature", name: "Temperature", selector: "#old a", index: 1, expected_match_count: 2, attribute: "title", unit: "°C", value_type: "text" }],
        };
        if (message.type === "web_data_assistant/create_source") return { entry_id: "created" };
        if (message.type === "web_data_assistant/update_source") return source;
        if (message.type === "web_data_assistant/repair_entity") return { entry_id: "weather", entity_key: "temperature", source: { ...source, extraction_error_count: 0, extraction_issues: [] } };
        throw new Error(`Unexpected command: ${message.type}`);
      },
    };
  }, { fixture: match, existingSource: existing });
  return { panel: page.locator("web-data-assistant-panel"), errors };
}

async function chooseReading(panel) {
  await panel.getByRole("button", { name: /Web page/ }).click();
  await panel.getByLabel("Source name", { exact: true }).fill("Weather");
  await panel.getByLabel("URL", { exact: true }).fill("https://example.test/weather");
  await panel.getByLabel("Current text or value", { exact: true }).fill("14°C");
  await panel.getByRole("button", { name: "Find matches", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Add this value as a sensor" })).toBeVisible();
}

async function openOptions(panel) {
  const picker = panel.locator("wda-selector-options");
  await picker.getByText("Advanced selector options", { exact: true }).click();
  return picker;
}

async function lastMessage(page, type) {
  return page.evaluate((command) => window.__messages.filter((message) => message.type === command).at(-1), `web_data_assistant/${type}`);
}

test("production module loads recommended choice without requiring Advanced", async ({ page }) => {
  const { panel, errors } = await mount(page);
  await chooseReading(panel);
  const picker = panel.locator("wda-selector-options");
  await expect(picker).toContainText("Strong · Unique match");
  await expect(picker.getByLabel("Custom CSS selector")).not.toBeVisible();
  await expect(panel.locator("iframe")).toHaveCount(0);
  await panel.getByLabel("New sensor name", { exact: true }).fill("Temperature");
  await panel.getByRole("button", { name: "Add sensor", exact: true }).click();
  await panel.getByRole("button", { name: "Create in Home Assistant", exact: true }).click();
  expect((await lastMessage(page, "create_source")).entities[0]).toMatchObject({ selector: "#weather a", index: 0, expected_match_count: 1, name: "Temperature" });
  expect(errors).toEqual([]);
});

test("advanced alternative preserves name and unit and sends exact locator and guard", async ({ page }) => {
  const { panel, errors } = await mount(page);
  await chooseReading(panel);
  await panel.getByLabel("New sensor name", { exact: true }).fill("Temperature");
  await panel.getByLabel("New sensor unit (optional)", { exact: true }).fill("°C");
  const picker = await openOptions(panel);
  await expect(picker.getByRole("radio")).toHaveCount(2);
  await expect(picker).toContainText("Recommended");
  await picker.getByRole("radio", { name: /Fragile/ }).check();
  await expect(panel.getByLabel("New sensor name", { exact: true })).toHaveValue("Temperature");
  await expect(panel.getByLabel("New sensor unit (optional)", { exact: true })).toHaveValue("°C");
  await expect(picker).toContainText("Match 17 of 17 (index 16)");
  await panel.getByRole("button", { name: "Add sensor", exact: true }).click();
  await panel.getByRole("button", { name: "Create in Home Assistant", exact: true }).click();
  expect((await lastMessage(page, "create_source")).entities[0]).toEqual({ key: "temperature", name: "Temperature", selector: "a", index: 16, value_type: "text", unit: "°C", expected_match_count: 17 });
  expect(errors).toEqual([]);
});

test("custom edits need a successful test and explicit Use; failure does not replace selection", async ({ page }) => {
  const { panel, errors } = await mount(page);
  await chooseReading(panel);
  const picker = await openOptions(panel);
  await picker.getByLabel("Custom CSS selector").fill("#forecast a");
  await picker.getByLabel("Match index (starts at 0)").fill("1");
  await expect(picker.getByRole("button", { name: "Use tested selector" })).toBeDisabled();
  await page.evaluate(() => { window.__testFailure = true; });
  await picker.getByRole("button", { name: "Test selector", exact: true }).click();
  await expect(picker.getByRole("alert")).toContainText("Invalid CSS selector");
  expect(await page.evaluate(() => document.querySelector("web-data-assistant-panel")._selectedExtraction.selector)).toBe("#weather a");
  await page.evaluate(() => { window.__testFailure = false; });
  await picker.getByRole("button", { name: "Test selector", exact: true }).click();
  await expect(picker.locator("#test-result")).toContainText("19°C");
  expect(await page.evaluate(() => document.querySelector("web-data-assistant-panel")._selectedExtraction.selector)).toBe("#weather a");
  await picker.getByRole("button", { name: "Use tested selector" }).click();
  await panel.getByLabel("New sensor name", { exact: true }).fill("Forecast temperature");
  await panel.getByRole("button", { name: "Add sensor", exact: true }).click();
  await panel.getByRole("button", { name: "Create in Home Assistant", exact: true }).click();
  expect((await lastMessage(page, "create_source")).entities[0]).toMatchObject({ selector: "#forecast a", index: 1, expected_match_count: 2 });
  expect(errors).toEqual([]);
});

test("editing a tested index invalidates the result and request changes require retest", async ({ page }) => {
  const { panel } = await mount(page);
  await chooseReading(panel);
  const picker = await openOptions(panel);
  await picker.getByRole("button", { name: "Test selector", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Use tested selector" })).toBeEnabled();
  await picker.getByLabel("Match index (starts at 0)").fill("1");
  await expect(picker.getByRole("button", { name: "Use tested selector" })).toBeDisabled();
  await picker.getByRole("button", { name: "Test selector", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Use tested selector" })).toBeEnabled();
  // Verify canonical request settings are checked even without a full rerender.
  await page.evaluate(() => { document.querySelector("web-data-assistant-panel")._form.verifySsl = false; });
  await picker.getByRole("button", { name: "Use tested selector" }).click();
  await expect(picker.getByRole("alert")).toContainText("settings changed");
  expect(await page.evaluate(() => document.querySelector("web-data-assistant-panel")._selectedExtraction.index)).toBe(0);
});

test("a late test cannot modify a different source after switching modes", async ({ page }) => {
  const { panel, errors } = await mount(page);
  await chooseReading(panel);
  const picker = await openOptions(panel);
  await page.evaluate(() => { window.__delayTest = true; });
  await picker.getByRole("button", { name: "Test selector", exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__finishTest)).toBe("function");
  await panel.locator('[data-source="json"]').click();
  await page.evaluate(() => { window.__finishTest(); });
  await expect(panel.locator("wda-selector-options")).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector("web-data-assistant-panel")._selectedExtraction)).toBeNull();
  expect(errors).toEqual([]);
});

test("Repair uses the same advanced picker and preserves the entity key", async ({ page }) => {
  const { panel, errors } = await mount(page, { existing: true });
  await panel.getByRole("button", { name: "Repair", exact: true }).click();
  await panel.getByLabel("Current text or value", { exact: true }).fill("14°C");
  await panel.getByRole("button", { name: "Find matches", exact: true }).click();
  const picker = await openOptions(panel);
  await picker.getByRole("radio", { name: /Fragile/ }).check();
  await panel.getByRole("button", { name: "Apply repair", exact: true }).click();
  expect(await lastMessage(page, "repair_entity")).toEqual({ type: "web_data_assistant/repair_entity", entry_id: "weather", entity_key: "temperature", selector: "a", index: 16, expected_match_count: 17 });
  expect(await lastMessage(page, "create_source")).toBeUndefined();
  expect(errors).toEqual([]);
});

for (const action of ["Edit", "Duplicate"]) {
  test(`${action} retains existing guard and attribute extraction`, async ({ page }) => {
    const { panel, errors } = await mount(page, { existing: true });
    await panel.getByRole("button", { name: action, exact: true }).click();
    await panel.getByRole("button", { name: action === "Edit" ? "Save changes" : "Create copy", exact: true }).click();
    const message = await lastMessage(page, action === "Edit" ? "update_source" : "create_source");
    expect(message.entities[0]).toMatchObject({ key: "temperature", selector: "#old a", index: 1, expected_match_count: 2, attribute: "title", unit: "°C" });
    expect(errors).toEqual([]);
  });
}

test("custom picker works on narrow screens and renders source content as text", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { panel, errors } = await mount(page);
  await chooseReading(panel);
  const picker = await openOptions(panel);
  await picker.getByLabel("Custom CSS selector").fill('[data-note="<img src=x onerror=alert(1)>"]');
  await picker.getByRole("button", { name: "Test selector", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Use tested selector" })).toBeEnabled();
  await expect(picker.locator("img")).toHaveCount(0);
  expect(await picker.evaluate((element) => element.shadowRoot.querySelector(".custom").scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
