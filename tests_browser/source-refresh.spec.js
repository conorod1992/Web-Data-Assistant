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
              source_available: false,
              extraction_error_count: 0,
              last_successful_update: null,
            }],
          };
        }
        if (message.type === "web_data_assistant/refresh_source") {
          return {
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
          };
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });
}

test("manual refresh updates the configured source card", async ({ page }) => {
  await mountPanel(page);
  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Weather API" });

  await expect(card.locator(".health")).toContainText("Source unavailable");
  await expect(card).toContainText("Last success: Never");

  await card.getByRole("button", { name: "Refresh now" }).click();

  await expect(card.locator(".health")).toHaveClass(/available/);
  await expect(card.locator(".health")).toContainText("Available");
  await expect(card).not.toContainText("Last success: Never");

  const refreshMessage = await page.evaluate(() =>
    window.__webDataMessages.find((message) => message.type === "web_data_assistant/refresh_source")
  );
  expect(refreshMessage).toEqual({
    type: "web_data_assistant/refresh_source",
    entry_id: "weather-entry",
  });
});

test("failed manual refresh keeps the existing source card and re-enables refresh", async ({ page }) => {
  await page.setContent("<web-data-assistant-panel></web-data-assistant-panel>");
  await page.addScriptTag({ path: PANEL_SCRIPT });
  await page.evaluate(() => {
    const panel = document.querySelector("web-data-assistant-panel");
    panel.hass = {
      callWS: async (message) => {
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
              source_available: false,
              extraction_error_count: 0,
              last_successful_update: null,
            }],
          };
        }
        if (message.type === "web_data_assistant/refresh_source") {
          throw new Error("Refresh request failed");
        }
        throw new Error(`Unexpected WebSocket call: ${message.type}`);
      },
    };
  });

  const shadow = page.locator("web-data-assistant-panel").locator(":scope");
  const card = shadow.locator(".source-card").filter({ hasText: "Weather API" });
  const refresh = card.getByRole("button", { name: "Refresh now" });

  await refresh.click();

  await expect(shadow.locator(".error")).toContainText("Refresh request failed");
  await expect(card).toBeVisible();
  await expect(card.locator(".health")).toContainText("Source unavailable");
  await expect(card).toContainText("Last success: Never");
  await expect(refresh).toBeEnabled();
});
