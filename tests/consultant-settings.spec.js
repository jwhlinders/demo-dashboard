const path = require("node:path");
const { test, expect } = require("@playwright/test");

async function openSettingsWithRequests(page, requests) {
  await page.route((url) => new URL(url).pathname === "/settings", (route) => route.fulfill({
    path: path.join(__dirname, "..", "src", "consultant-settings.html"),
  }));
  await page.route("**/api/consultant/settings", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ role: "consultant" }),
  }));
  await page.route("**/api/consultant/password-reset-requests", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(requests),
  }));
  await page.goto("/settings");
}

test("shows account types on reset requests returned for a beheerder", async ({ page }) => {
  await openSettingsWithRequests(page, [
    { id: "client-request", username: "aclient", name: "A Client", accountType: "client", status: "nieuw" },
    { id: "consultant-request", username: "aconsultant", name: "A Consultant", accountType: "consultant", status: "nieuw" },
  ]);

  const requests = page.locator("#password-reset-requests li");
  await expect(requests).toHaveCount(2);
  await expect(requests.nth(0)).toContainText("A Client (aclient) · Cliënt");
  await expect(requests.nth(1)).toContainText("A Consultant (aconsultant) · Consultant");
});

test("does not show an account type for regular consultant requests", async ({ page }) => {
  await openSettingsWithRequests(page, [
    { id: "client-request", username: "aclient", name: "A Client", accountType: null, status: "nieuw" },
  ]);

  await expect(page.locator("#password-reset-requests li")).toHaveCount(1);
  await expect(page.locator("#password-reset-requests li")).toHaveText(/A Client \(aclient\)/);
  await expect(page.locator("#password-reset-requests li")).not.toContainText("Cliënt");
  await expect(page.locator("#password-reset-requests li")).not.toContainText("Consultant");
});
