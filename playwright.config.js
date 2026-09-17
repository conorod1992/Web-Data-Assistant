const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests_browser",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  reporter: "line",
});
