import { expect } from "@playwright/test";
import { createBdd, test } from "playwright-bdd";
import type { Page } from "@playwright/test";
import { LoginPage } from "../pages/login-page";

const { Given, When, Then } = createBdd();

interface Credentials {
  username: string;
  password: string;
}

interface LoginScenario {
  login: LoginPage;
  credentials?: Credentials;
  knownUserMessage?: string;
}

const scenarios = new WeakMap<Page, LoginScenario>();

const clientUser: Credentials = {
  username: process.env.E2E_CLIENT_USERNAME ?? "testuser",
  password: process.env.E2E_CLIENT_PASSWORD ?? "Test1234!",
};

function getScenario(page: Page): LoginScenario {
  const scenario = scenarios.get(page);
  if (!scenario) {
    throw new Error("De logincontext is niet geïnitialiseerd.");
  }
  return scenario;
}

Given("ik ben op de loginpagina", async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  scenarios.set(page, { login });
});

Given("het hamburgermenu is gesloten", async ({ page }) => {
  const menu = page.getByRole("navigation", { name: "Hoofdnavigatie" });
  await expect(menu).toBeHidden();
});

When("ik het hamburgermenu open", async ({ page }) => {
  await page.getByRole("button", { name: "Menu openen" }).click();
});

Then("zie ik de links voor status, wachtwoord resetten en registratie", async ({ page }) => {
  const menu = page.getByRole("navigation", { name: "Hoofdnavigatie" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: "Opvragen status" })).toHaveAttribute(
    "href",
    "/password-reset-status",
  );
  await expect(menu.getByRole("link", { name: "Reset wachtwoord" })).toHaveAttribute(
    "href",
    "/password-reset-request",
  );
  await expect(menu.getByRole("link", { name: "Registreer (cliënt)" })).toHaveAttribute(
    "href",
    "/register",
  );
  await expect(menu.getByRole("link", { name: "Registreer (consultant)" })).toHaveAttribute(
    "href",
    "/consultant",
  );
});

When("ik op Escape druk", async ({ page }) => {
  await page.keyboard.press("Escape");
});

Then("sluit het menu en krijgt de menuknop de focus", async ({ page }) => {
  const menu = page.getByRole("navigation", { name: "Hoofdnavigatie" });
  const menuToggle = page.getByRole("button", { name: "Menu openen" });
  await expect(menu).toBeHidden();
  await expect(menuToggle).toBeFocused();
});

Given("ik beschik over geldige cliëntgegevens", async ({ page }) => {
  getScenario(page).credentials = clientUser;
});

When("ik inlog met mijn gebruikersnaam en wachtwoord", async ({ page }) => {
  const { login, credentials } = getScenario(page);
  if (!credentials) throw new Error("Er zijn geen inloggegevens ingesteld voor dit scenario.");
  await login.login(credentials.username, credentials.password);
});

When("ik mijn gebruikersnaam en wachtwoord invul en op Enter druk", async ({ page }) => {
  const { login, credentials } = getScenario(page);
  if (!credentials) throw new Error("Er zijn geen inloggegevens ingesteld voor dit scenario.");
  await login.fillCredentials(credentials.username, credentials.password);
  await login.password.press("Enter");
});

Then("word ik ingelogd en ga ik naar het dashboard", async ({ page }) => {
  await getScenario(page).login.expectLoggedIn();
});

When("ik een wachtwoord invul", async ({ page }) => {
  await getScenario(page).login.password.fill("GeheimWachtwoord1");
});

Then("wordt het wachtwoord gemaskeerd weergegeven", async ({ page }) => {
  await getScenario(page).login.expectPasswordMasked();
});

When("ik eerst met een verkeerd wachtwoord probeer in te loggen", async ({ page }) => {
  const { login, credentials } = getScenario(page);
  if (!credentials) throw new Error("Er zijn geen inloggegevens ingesteld voor dit scenario.");
  await login.login(credentials.username, "FoutWachtwoord!1");
});

Then("zie ik een foutmelding", async ({ page }) => {
  await expect(getScenario(page).login.error).toBeVisible();
});

When("ik daarna mijn geldige wachtwoord invul en inlog", async ({ page }) => {
  const { login, credentials } = getScenario(page);
  if (!credentials) throw new Error("Er zijn geen inloggegevens ingesteld voor dit scenario.");
  await login.fillCredentials(credentials.username, credentials.password);
  await login.signIn.click();
});

When("ik met een verkeerd wachtwoord probeer in te loggen", async ({ page }) => {
  const { login, credentials } = getScenario(page);
  if (!credentials) throw new Error("Er zijn geen inloggegevens ingesteld voor dit scenario.");
  await login.login(credentials.username, "FoutWachtwoord!1");
});

Then("zie ik een generieke foutmelding", async ({ page }) => {
  await expect(getScenario(page).login.error).toContainText(
    /onjuist|ongeldig|incorrect|invalid/i,
  );
});

Then("blijf ik uitgelogd", async ({ page }) => {
  await getScenario(page).login.expectNotLoggedIn();
});

Given(
  "ik heb de foutmelding gezien na een poging met een bestaande gebruikersnaam en verkeerd wachtwoord",
  async ({ page }) => {
    const { login } = getScenario(page);
    await login.login(clientUser.username, "FoutWachtwoord!1");
    await expect(login.error).toBeVisible();
    getScenario(page).knownUserMessage = (await login.error.innerText()).trim();
  },
);

When("ik daarna met een onbekende gebruikersnaam probeer in te loggen", async ({ page }) => {
  const { login } = getScenario(page);
  await page.reload();
  await login.login("bestaat_niet_xyz_123", "Willekeurig!1");
});

Then("is de foutmelding hetzelfde", async ({ page }) => {
  const { login, knownUserMessage } = getScenario(page);
  if (knownUserMessage === undefined) {
    throw new Error("De foutmelding voor een bestaande gebruiker is niet opgeslagen.");
  }
  await expect(login.error).toContainText(/onjuist|ongeldig|incorrect|invalid/i);
  await expect((await login.error.innerText()).trim()).toBe(knownUserMessage);
});

When("ik het formulier leeg verstuur", async ({ page }) => {
  await getScenario(page).login.signIn.click();
});

Then("wordt aangegeven dat de gebruikersnaam verplicht is", async ({ page }) => {
  const { login } = getScenario(page);
  await login.expectRequiredValidation(login.username);
});

Given("ik heb mijn gebruikersnaam ingevuld", async ({ page }) => {
  const { login } = getScenario(page);
  await login.username.fill(clientUser.username);
});

When("ik het formulier verstuur zonder wachtwoord", async ({ page }) => {
  await getScenario(page).login.signIn.click();
});

Then("wordt aangegeven dat het wachtwoord verplicht is", async ({ page }) => {
  const { login } = getScenario(page);
  await login.expectRequiredValidation(login.password);
});

Given(/^ik beschik over geldige gegevens voor een (.+)$/, async ({ page }, role: string) => {
  let credentials: Credentials | undefined;
  let requiredVariables: string;

  if (role === "consultant") {
    const username = process.env.E2E_CONSULTANT_USERNAME;
    const password = process.env.E2E_CONSULTANT_PASSWORD;
    requiredVariables = "E2E_CONSULTANT_USERNAME en E2E_CONSULTANT_PASSWORD";
    if (username && password) credentials = { username, password };
  } else if (role === "cliënt") {
    credentials = clientUser;
    requiredVariables = "E2E_CLIENT_USERNAME en E2E_CLIENT_PASSWORD";
  } else {
    throw new Error(`Onbekende gebruikersrol in feature: ${role}`);
  }

  if (!credentials) {
    test.skip(true, `Zet ${requiredVariables} om deze test te draaien`);
    return;
  }

  getScenario(page).credentials = credentials;
});

When("ik inlog met spaties rond mijn gebruikersnaam", async ({ page }) => {
  const { login, credentials } = getScenario(page);
  if (!credentials) throw new Error("Er zijn geen inloggegevens ingesteld voor dit scenario.");
  await login.login(` ${credentials.username} `, credentials.password);
});

Then("word ik ingelogd", async ({ page }) => {
  await getScenario(page).login.expectLoggedIn();
});

When("ik inlog met mijn gebruikersnaam in hoofdletters", async ({ page }) => {
  const { login, credentials } = getScenario(page);
  if (!credentials) throw new Error("Er zijn geen inloggegevens ingesteld voor dit scenario.");
  await login.login(credentials.username.toUpperCase(), credentials.password);
});

When("ik inlog met mijn wachtwoord in hoofdletters", async ({ page }) => {
  const { login, credentials } = getScenario(page);
  if (!credentials) throw new Error("Er zijn geen inloggegevens ingesteld voor dit scenario.");
  await login.login(credentials.username, credentials.password.toUpperCase());
});

When("ik inlog met SQL-injectie als gebruikersnaam en wachtwoord", async ({ page }) => {
  await getScenario(page).login.login("' OR '1'='1", "' OR '1'='1");
});

Then("zie ik geen technische foutmelding", async ({ page }) => {
  await expect(page.getByText(/sql|syntax|exception|stack trace|ORA-\d+/i)).toHaveCount(0);
});
