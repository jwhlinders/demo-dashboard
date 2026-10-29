import { test, expect } from "@playwright/test";

test("shows the created account credentials and returns to login after confirmation", async ({ page }) => {
  const credentials = {
    username: "nieuwe.client",
    password: "Tijdelijk123!",
  };
  await page.route("**/api/register", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(credentials),
    }),
  );
  await page.goto("/register");
  await page.locator("#first-name").fill("Nieuwe");
  await page.locator("#last-name").fill("Client");
  await expect(page.locator("#email")).toHaveValue("nieuwe.client@dashboard.nl");

  await page.getByRole("button", { name: "Account aanmaken" }).click();
  const confirmation = page.getByRole("dialog", { name: "Je account is aangemaakt" });
  await expect(confirmation).toBeVisible();
  await expect(page.locator("#created-username")).toHaveValue(credentials.username);
  await expect(page.locator("#created-password")).toHaveValue(credentials.password);

  await page.getByRole("button", { name: "OK" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welkom terug" })).toBeVisible();
});
