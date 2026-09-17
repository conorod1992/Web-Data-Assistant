const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);

test("panel remains usable without horizontal overflow on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate(() => {
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        if (message.type === "web_data_assistant/list_sources") return { sources: [] };
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  await expect(shadow.getByRole("heading", { name: "Web Data Assistant" })).toBeVisible();
  await expect(shadow.getByLabel("Source name")).toBeVisible();
  await expect(shadow.getByLabel("URL")).toBeVisible();
  await expect(shadow.getByRole("button", { name: "Load JSON" })).toBeVisible();

  const metrics = await page.locator("web-data-assistant-panel").evaluate((panel) => {
    const pageNode = panel.shadowRoot.querySelector(".page");
    const grid = panel.shadowRoot.querySelector(".grid");
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
      pageWidth: pageNode.getBoundingClientRect().width,
      gridColumns: getComputedStyle(grid).gridTemplateColumns,
    };
  });

  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth);
  expect(metrics.panelScrollWidth).toBeLessThanOrEqual(metrics.panelClientWidth);
  expect(metrics.pageWidth).toBeLessThanOrEqual(390);
  expect(metrics.gridColumns.trim().split(/\s+/)).toHaveLength(1);
});
