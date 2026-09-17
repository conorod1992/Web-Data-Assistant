const path = require("node:path");
const { test, expect } = require("@playwright/test");

const PANEL_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/web-data-assistant-panel.js"
);
const LIFECYCLE_SCRIPT = path.resolve(
  __dirname,
  "../custom_components/web_data_assistant/frontend/source-lifecycle.js"
);

async function mountPanel(page) {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.addScriptTag({ path: LIFECYCLE_SCRIPT });
  await page.evaluate(() => {
    window.__webDataMessages = [];
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
        window.__webDataMessages.push(structuredClone(message));
        if (message.type === "web_data_assistant/list_sources") {
          return {
            sources: [{
              entry_id: "weather-entry",
              title: "Weather API",
              state: "loaded",
              source_type: "json",
              url: "https://example.test/weather",
              entity_count: 2,
              scan_interval: 5,
              failure_mode: "unavailable",
              source_available: true,
              extraction_error_count: 0,
              last_successful_update: "2026-09-17T17:20:00+00:00",
            }],
          };
        }
        if (message.type === "web_data_assistant/delete_source") {
          return { entry_id: message.entry_id };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });
}

test("deleting a source requires inline confirmation and removes its card", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Weather API" });

  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(card.getByText("Delete Weather API?")).toBeVisible();
  await expect(card.getByText(/removes the source and its Home Assistant sensor entities/i)).toBeVisible();

  let deleteMessages = await page.evaluate(() =>
    window.__webDataMessages.filter((message) => message.type === "web_data_assistant/delete_source")
  );
  expect(deleteMessages).toEqual([]);

  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByText("Delete Weather API?")).toHaveCount(0);

  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await card.getByRole("button", { name: "Delete source" }).click();

  await expect(card).toHaveCount(0);
  await expect(shadow.getByText("Deleted Weather API.")).toBeVisible();

  deleteMessages = await page.evaluate(() =>
    window.__webDataMessages.filter((message) => message.type === "web_data_assistant/delete_source")
  );
  expect(deleteMessages).toEqual([{
    type: "web_data_assistant/delete_source",
    entry_id: "weather-entry",
  }]);
});
