import { test, expect, type Page, type Locator } from '@playwright/test';
import { LoginPage } from './pages/login-page';

/* ------------------------------------------------------------------ */
/* CONFIGURATIE: pas aan op basis van je functionele documentatie      */
/* ------------------------------------------------------------------ */
const CONFIG = {
  loginUrl: '/login', // URL van de loginpagina
  successUrl: /\/dashboard$/, // URL na succesvolle login
  consultantUser: process.env.E2E_CONSULTANT_USERNAME && process.env.E2E_CONSULTANT_PASSWORD
    ? { username: process.env.E2E_CONSULTANT_USERNAME, password: process.env.E2E_CONSULTANT_PASSWORD }
    : undefined,
  clientUser: {
    username: process.env.E2E_CLIENT_USERNAME ?? 'testuser',
    password: process.env.E2E_CLIENT_PASSWORD ?? 'Test1234!',
  },
  // Gedrag volgens specificatie (TC-09)
  usernameTrimmed: true, // true = spaties worden getrimd, false = geweigerd
  usernameCaseSensitive: false, // true = hoofdlettergevoelig
  genericError: /onjuist|ongeldig|incorrect|invalid/i, // foutmelding bij foute login
  requiredError: /verplicht|required|vul .* in/i, // melding bij lege velden
};

test.describe('Loginpagina - functionele testcases', () => {
  let login: LoginPage;

  test.beforeEach(async ({ page }) => {
    login = new LoginPage(page);
    await login.goto();
  });

  test('hamburgermenu toont status- en registratiepagina’s', async ({ page }) => {
    const menuToggle = page.getByRole('button', { name: 'Menu openen' });
    const menu = page.getByRole('navigation', { name: 'Hoofdnavigatie' });

    await expect(menu).toBeHidden();
    await menuToggle.click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Opvragen status' })).toHaveAttribute('href', '/password-reset-status');
    await expect(menu.getByRole('link', { name: 'Reset wachtwoord' })).toHaveAttribute('href', '/password-reset-request');
    await expect(menu.getByRole('link', { name: 'Registreer (cliënt)' })).toHaveAttribute('href', '/register');
    await expect(menu.getByRole('link', { name: 'Registreer (consultant)' })).toHaveAttribute('href', '/consultant');

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(menuToggle).toBeFocused();
  });

  /* ---------------------------- POSITIEF --------------------------- */

  test('TC-01: succesvol inloggen met geldige gegevens', async () => {
    await login.login(CONFIG.clientUser.username, CONFIG.clientUser.password);
    await login.expectLoggedIn();
  });

  test('TC-02: inloggen met Enter-toets', async () => {
    await login.fillCredentials(CONFIG.clientUser.username, CONFIG.clientUser.password);
    await login.password.press('Enter');
    await login.expectLoggedIn();
  });

  test('TC-03: wachtwoord is gemaskeerd', async () => {
    await login.password.fill('GeheimWachtwoord1');
    await expect(login.password).toHaveAttribute('type', 'password');
  });

  test('TC-04: inloggen na eerder mislukte poging', async () => {
    await login.login(CONFIG.clientUser.username, 'FoutWachtwoord!1');
    await expect(login.error).toBeVisible();

    await login.password.fill(CONFIG.clientUser.password);
    await login.username.fill(CONFIG.clientUser.username);
    await login.signIn.click();

    await login.expectLoggedIn();
  });

  /* ---------------------------- NEGATIEF --------------------------- */

  test('TC-05: verkeerd wachtwoord', async () => {
    await login.login(CONFIG.clientUser.username, 'FoutWachtwoord!1');
    await expect(login.error).toContainText(CONFIG.genericError);
    await login.expectNotLoggedIn();
  });

  test('TC-06: onbekende gebruikersnaam geeft dezelfde generieke melding', async ({ page }) => {
    // Referentie: melding bij bestaande gebruiker + fout wachtwoord
    await login.login(CONFIG.clientUser.username, 'FoutWachtwoord!1');
    await expect(login.error).toBeVisible();
    const knownUserMessage = (await login.error.innerText()).trim();

    await page.reload();
    await login.login('bestaat_niet_xyz_123', 'Willekeurig!1');
    await expect(login.error).toContainText(CONFIG.genericError);
    const unknownUserMessage = (await login.error.innerText()).trim();

    // Geen user enumeration: identieke melding
    expect(unknownUserMessage).toBe(knownUserMessage);
    await login.expectNotLoggedIn();
  });

  test('TC-07: beide velden leeg', async () => {
    await login.signIn.click();
    await login.expectRequiredValidation(login.username);
    await login.expectNotLoggedIn();
  });

  test('TC-08: alleen wachtwoord leeg', async () => {
    await login.username.fill(CONFIG.clientUser.username);
    await login.signIn.click();
    await login.expectRequiredValidation(login.password);
    await login.expectNotLoggedIn();
  });

  /* ---------------------------- EDGE CASES ------------------------- */

  test.describe('TC-09: spaties en hoofdlettergevoeligheid', () => {
    const e2eUsers = [
      {
        role: 'consultant',
        user: CONFIG.consultantUser,
        requiredVariables: 'E2E_CONSULTANT_USERNAME en E2E_CONSULTANT_PASSWORD',
      },
      {
        role: 'cliënt',
        user: CONFIG.clientUser,
        requiredVariables: 'E2E_CLIENT_USERNAME en E2E_CLIENT_PASSWORD',
      },
    ];

    for (const { role, user, requiredVariables } of e2eUsers) {
      test(`TC-09a: spaties rond gebruikersnaam (${role})`, async () => {
        test.skip(!user, `Zet ${requiredVariables} om deze test te draaien`);

        if (!user) return; // TypeScript type guard

        await login.login(` ${user.username} `, user.password);
        if (CONFIG.usernameTrimmed) {
          await login.expectLoggedIn();
        } else {
          await login.expectNotLoggedIn();
        }
      });

      test(`TC-09b: gebruikersnaam in hoofdletters (${role})`, async () => {
        test.skip(!user, `Zet ${requiredVariables} om deze test te draaien`);
        if (!user) return; // TypeScript type guard
        await login.login(user.username.toUpperCase(), user.password);
        if (CONFIG.usernameCaseSensitive) {
          await login.expectNotLoggedIn();
        } else {
          await login.expectLoggedIn();
        }
      });

      test(`TC-09c: wachtwoord is hoofdlettergevoelig (${role})`, async () => {
        test.skip(!user, `Zet ${requiredVariables} om deze test te draaien`);
        if (!user) return; // TypeScript type guard
        await login.login(user.username, user.password.toUpperCase());
        await login.expectNotLoggedIn();
      });
    }
  });

  test.describe('TC-10: speciale tekens en SQL-injectie', () => {
    test('TC-10a: SQL-injectie wordt geweigerd zonder databasefout', async ({ page }) => {
      await login.login("' OR '1'='1", "' OR '1'='1");
      await login.expectNotLoggedIn();
      // Geen technische foutmelding zichtbaar
      await expect(page.getByText(/sql|syntax|exception|stack trace|ORA-\d+/i)).toHaveCount(0);
    });

   
  });
});