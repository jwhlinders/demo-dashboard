const fs = require("node:fs");
const { defineConfig } = require("@playwright/test");

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

module.exports = defineConfig({
  testDir: "./tests",
  use: {
    baseURL,
    browserName: "chromium",
  },
  webServer: {
    command: "npm start",
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
