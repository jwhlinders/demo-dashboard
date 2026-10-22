const fs = require("node:fs");
const { defineConfig } = require("@playwright/test");

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const port = process.env.PLAYWRIGHT_PORT || "3100";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${port}`;

module.exports = defineConfig({
  testDir: "./tests",
  use: {
    baseURL,
    browserName: "chromium",
  },
  webServer: {
    command: "node src/server.js",
    env: { PORT: port },
    url: `${baseURL}/login`,
    reuseExistingServer: Boolean(process.env.PLAYWRIGHT_BASE_URL) && !process.env.CI,
    timeout: 120_000,
  },
});
