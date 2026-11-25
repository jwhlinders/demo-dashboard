import { defineConfig } from "@playwright/test";
import config from "./playwright.config.js";

const baseURL = process.env.PLAYWRIGHT_SMOKE_BASE_URL;
const username = process.env.E2E_SMOKE_USERNAME;
const password = process.env.E2E_SMOKE_PASSWORD;
const clientUsername = process.env.E2E_SMOKE_CLIENT_USERNAME;
const clientPassword = process.env.E2E_SMOKE_CLIENT_PASSWORD;
const missingVariables = [
  ["PLAYWRIGHT_SMOKE_BASE_URL", baseURL],
  ["E2E_SMOKE_USERNAME", username],
  ["E2E_SMOKE_PASSWORD", password],
  ["E2E_SMOKE_CLIENT_USERNAME", clientUsername],
  ["E2E_SMOKE_CLIENT_PASSWORD", clientPassword]
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingVariables.length) {
  throw new Error(`Stel deze variabelen in .env in voor de smoke-test: ${missingVariables.join(", ")}`);
}

process.env.E2E_CLIENT_USERNAME = clientUsername;
process.env.E2E_CLIENT_PASSWORD = clientPassword;
process.env.E2E_CONSULTANT_USERNAME = username;
process.env.E2E_CONSULTANT_PASSWORD = password;

export default defineConfig({
  ...config,
  use: {
    ...config.use,
    baseURL,
  },
  webServer: undefined,
});
