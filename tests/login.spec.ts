import { test, expect, type Page, type Locator } from '@playwright/test';
import { LoginPage } from './pages/login-page';

/* ------------------------------------------------------------------ */
/* CONFIGURATIE: pas aan op basis van je functionele documentatie      */
/* ------------------------------------------------------------------ */
const CONFIG = {
  loginUrl: '/login', // URL van de loginpagina
  successUrl: /\/dashboard$/, // URL na succesvolle login
  validUser: { username: process.env.TEST_USER ?? 'testuser', password: process.env.TEST_PASS ?? 'Test1234!' },
  consultantUser: process.env.E2E_CONSULTANT_USERNAME && process.env.E2E_CONSULTANT_PASSWORD
    ? { username: process.env.E2E_CONSULTANT_USERNAME, password: process.env.E2E_CONSULTANT_PASSWORD }
    : undefined,
  clientUser: process.env.E2E_CLIENT_USERNAME && process.env.E2E_CLIENT_PASSWORD
    ? { username: process.env.E2E_CLIENT_USERNAME, password: process.env.E2E_CLIENT_PASSWORD }
    : undefined,
  // Optioneel: gebruiker met speciale tekens in wachtwoord (TC-10)
  specialUser: process.env.SPECIAL_USER
    ? { username: process.env.SPECIAL_USER, password: process.env.SPECIAL_PASS ?? 'P@ss!#€%&' }
    : undefined,
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

  /* ---------------------------- POSITIEF --------------------------- */

  test('TC-01: succesvol inloggen met geldige gegevens', async () => {
    await login.login(CONFIG.validUser.username, CONFIG.validUser.password);
    await login.expectLoggedIn();
  });

  test('TC-02: inloggen met Enter-toets', async () => {
    await login.fillCredentials(CONFIG.validUser.username, CONFIG.validUser.password);
    await login.password.press('Enter');
    await login.expectLoggedIn();
  });

  test('TC-03: wachtwoord is gemaskeerd', async () => {
    await login.password.fill('GeheimWachtwoord1');
    await expect(login.password).toHaveAttribute('type', 'password');
  });

  test('TC-04: inloggen na eerder mislukte poging', async () => {
    await login.login(CONFIG.validUser.username, 'FoutWachtwoord!1');
    await expect(login.error).toBeVisible();

    await login.password.fill(CONFIG.validUser.password);
    await login.username.fill(CONFIG.validUser.username);
    await login.signIn.click();

    await login.expectLoggedIn();
  });

  /* ---------------------------- NEGATIEF --------------------------- */

  test('TC-05: verkeerd wachtwoord', async () => {
    await login.login(CONFIG.validUser.username, 'FoutWachtwoord!1');
    await expect(login.error).toContainText(CONFIG.genericError);
    await login.expectNotLoggedIn();
  });

  test('TC-06: onbekende gebruikersnaam geeft dezelfde generieke melding', async ({ page }) => {
    // Referentie: melding bij bestaande gebruiker + fout wachtwoord
    await login.login(CONFIG.validUser.username, 'FoutWachtwoord!1');
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
    await login.username.fill(CONFIG.validUser.username);
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

    test('TC-10b: geldig wachtwoord met speciale tekens', async () => {
      test.skip(!CONFIG.specialUser, 'Zet SPECIAL_USER en SPECIAL_PASS om deze test te draaien');
      if (!CONFIG.specialUser) return;
      await login.login(CONFIG.specialUser.username, CONFIG.specialUser.password);
      await login.expectLoggedIn();
    });
  });
});