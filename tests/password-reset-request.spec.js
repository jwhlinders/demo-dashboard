const { test, expect } = require("@playwright/test");

test("hides the submit button after displaying the tracking code", async ({ page }) => {
  await page.route("**/api/password-reset-requests", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({
      message: "Je aanvraag is ontvangen.",
      trackingCode: "ABCD2345",
    }),
  }));

  await page.goto("/password-reset-request");
  await page.locator("#request-username").fill("testgebruiker");
  await page.getByRole("button", { name: "Aanvraag versturen" }).click();

  await expect(page.locator("#request-success")).toHaveText(
    "De aanvraag is ingediend. De beheerder neemt contact met je op. Bewaar de statuscode i.v.m. vervolginstructies",
  );
  await expect(page.locator("#tracking-code")).toHaveValue("ABCD2345");
  await expect(page.getByRole("button", { name: "Aanvraag versturen" })).toBeHidden();
});

test("shows an informational message and keeps the button after a recent request", async ({ page }) => {
  await page.route("**/api/password-reset-requests", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      alreadySubmitted: true,
      message: "Aanvraag reeds ingediend",
    }),
  }));

  await page.goto("/password-reset-request");
  await page.locator("#request-username").fill("testgebruiker");
  await page.getByRole("button", { name: "Aanvraag versturen" }).click();

  await expect(page.locator("#request-info")).toHaveText("Aanvraag reeds ingediend");
  await expect(page.getByRole("button", { name: "Aanvraag versturen" })).toBeVisible();
  await expect(page.locator("#tracking-code-field")).toBeHidden();
});
