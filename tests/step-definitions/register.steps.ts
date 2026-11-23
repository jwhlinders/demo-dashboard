import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

const credentials = {
  username: "nieuwe.client",
  password: "Tijdelijk123!",
};

Given("ik ben op de registratiepagina", async ({ page }) => {
  await page.route("**/api/register", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(credentials),
    }),
  );
  await page.goto("/register");
});

When("ik mijn voor- en achternaam invul", async ({ page }) => {
  await page.locator("#first-name").fill("Nieuwe");
  await page.locator("#last-name").fill("Client");
});

Then("wordt mijn e-mailadres automatisch ingevuld", async ({ page }) => {
  await expect(page.locator("#email")).toHaveValue("nieuwe.client@dashboard.nl");
});

When("ik het account aanmaak", async ({ page }) => {
  await page.getByRole("button", { name: "Account aanmaken" }).click();
});

Then("zie ik een bevestiging met mijn gebruikersnaam en wachtwoord", async ({ page }) => {
  const confirmation = page.getByRole("dialog", { name: "Je account is aangemaakt" });
  await expect(confirmation).toBeVisible();
  await expect(page.locator("#created-username")).toHaveValue(credentials.username);
  await expect(page.locator("#created-password")).toHaveValue(credentials.password);
});

When("ik de registratie bevestig", async ({ page }) => {
  await page.getByRole("button", { name: "OK" }).click();
});

Then("keer ik terug naar de loginpagina", async ({ page }) => {
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welkom terug" })).toBeVisible();
});
