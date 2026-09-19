const path = require("node:path");
const { test, expect } = require("@playwright/test");
const SCRIPT = path.resolve(__dirname, "../custom_components/web_data_assistant/frontend/source-selector-ux.js");

async function mount(page, { attribute = null, delayed = false } = {}) {
  await page.setContent("<wda-selector-options></wda-selector-options>");
  await page.addScriptTag({ path: SCRIPT });
  await page.evaluate(({ attr, wait }) => {
    window.__calls = [];
    window.__selections = [];
    window.__pending = [];
    const element = document.querySelector("wda-selector-options");
    element.configure({
      match: null,
      attribute: attr,
      state: customElements.get("wda-selector-options").createState(null),
      request: () => ({ url: "https://example.test/weather", method: "GET", headers: {} }),
      hass: {
        callWS: async (message) => {
          window.__calls.push(message);
          const result = { selector: message.selector, index: message.index, match_count: 2, text: attr ? "Attribute value" : "Reading", context: "Current conditions", tag: "a" };
          if (wait) return new Promise((resolve) => window.__pending.push(() => resolve(result)));
          return result;
        },
      },
    });
    element.addEventListener("selector-chosen", (event) => window.__selections.push(event.detail));
  }, { attr: attribute, wait: delayed });
  const picker = page.locator("wda-selector-options");
  await picker.getByText("Advanced selector options", { exact: true }).click();
  return picker;
}

test("custom repair preserves attribute extraction before any text search", async ({ page }) => {
  const picker = await mount(page, { attribute: "title" });
  await picker.getByLabel("Custom CSS selector").fill("a.reading");
  await picker.getByLabel("Match index (starts at 0)").fill("01");
  await picker.getByRole("button", { name: "Test selector", exact: true }).click();
  await expect(picker.locator("#test-result")).toContainText("Attribute value");
  await picker.getByRole("button", { name: "Use tested selector" }).click();
  expect(await page.evaluate(() => window.__calls[0])).toMatchObject({ attribute: "title", selector: "a.reading", index: 1 });
  expect(await page.evaluate(() => window.__selections[0])).toMatchObject({ attribute: "title", selector: "a.reading", index: 1, match_count: 2 });
});

test("out-of-order responses cannot apply an older selector test", async ({ page }) => {
  const picker = await mount(page, { delayed: true });
  await picker.getByLabel("Custom CSS selector").fill("#old a");
  await picker.getByRole("button", { name: "Test selector", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__pending.length)).toBe(1);
  await picker.getByLabel("Custom CSS selector").fill("#new a");
  await picker.getByRole("button", { name: "Test selector", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__pending.length)).toBe(2);
  await page.evaluate(() => window.__pending[0]());
  await expect(picker.getByRole("button", { name: "Use tested selector" })).toBeDisabled();
  await page.evaluate(() => window.__pending[1]());
  await expect(picker.getByRole("button", { name: "Use tested selector" })).toBeEnabled();
  await picker.getByRole("button", { name: "Use tested selector" }).click();
  expect(await page.evaluate(() => window.__selections.map((item) => item.selector))).toEqual(["#new a"]);
});

test("empty selectors and negative indexes do not send requests", async ({ page }) => {
  const picker = await mount(page);
  await picker.getByRole("button", { name: "Test selector", exact: true }).click();
  await expect(picker.getByRole("alert")).toContainText("Enter a CSS selector");
  await picker.getByLabel("Custom CSS selector").fill("a");
  await picker.getByLabel("Match index (starts at 0)").fill("-1");
  await picker.getByRole("button", { name: "Test selector", exact: true }).click();
  await expect(picker.getByRole("alert")).toContainText("whole number starting at 0");
  expect(await page.evaluate(() => window.__calls)).toEqual([]);
});
