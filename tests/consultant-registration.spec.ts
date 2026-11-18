import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

type TestDatabasePool = {
  query: (sql: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};

const { Pool }: { Pool: new (options: { connectionString: string }) => TestDatabasePool } = require("pg");
const authorizationCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const username = `registration-${randomUUID()}`;
const authorizationCode = Array.from(
  randomBytes(8),
  (byte) => authorizationCodeAlphabet[byte % authorizationCodeAlphabet.length],
).join("");
let database: TestDatabasePool | undefined;
let postcode = "";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill("ConsultantPass2026!");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL;
  test.skip(!connectionString, "DATABASE_URL is required for the consultant registration test.");
  if (!connectionString) return;

  database = new Pool({ connectionString });
  const locationResult = await database.query(`
    SELECT idlocatie, postcode
    FROM locaties
    WHERE NULLIF(TRIM(postcode), '') IS NOT NULL
    LIMIT 1
  `, []);
  if (locationResult.rows.length === 0) throw new Error("A location with a postcode is required for the consultant registration test.");
  const location = locationResult.rows[0];
  postcode = String(location.postcode);

  await database.query(`
    INSERT INTO consultant (voornaam, achternaam, email, username, password, authorisatiecode, defaultlocatie)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    "Test",
    "Registratie",
    `${username}@example.invalid`,
    username,
    "InitialPassword2026!",
    authorizationCode,
    location.idlocatie,
  ]);
});

test.afterAll(async () => {
  if (!database) return;
  try {
    await database.query("DELETE FROM consultant WHERE username = $1", [username]);
  } finally {
    await database.end();
    database = undefined;
  }
});

test("consultant activates an account with their username and one-time authorization code", async ({ page }) => {
  await page.goto("/consultant");
  await expect(page.getByRole("heading", { name: "Consultant registreren" })).toBeVisible();
  await expect(page.locator("#consultant-registration-password")).toBeHidden();
  await page.locator("#consultant-username").fill(username);
  await page.locator("#consultant-authorisatiecode").fill(authorizationCode.toLowerCase());
  await page.locator("#consultant-postcode").fill("0000XX");
  await page.getByRole("button", { name: "Gegevens controleren" }).click();
  await expect(page.locator("#consultant-register-error")).toHaveText("De gebruikersnaam, authorisatiecode of postcode is onjuist.");
  await expect(page.locator("#consultant-registration-password")).toBeHidden();
  const incorrectPostcodeResponse = await page.request.post(
    new URL("/api/consultant/register", page.url()).toString(),
    {
      data: {
        username,
        authorisatiecode: authorizationCode,
        postcode: "0000XX",
        password: "ConsultantPass2026!",
        passwordConfirmation: "ConsultantPass2026!",
      },
    },
  );
  expect(incorrectPostcodeResponse.status()).toBe(400);

  await page.locator("#consultant-postcode").fill(`${postcode.slice(0, 4)} ${postcode.slice(4)}`);
  await page.getByRole("button", { name: "Gegevens controleren" }).click();
  await expect(page.locator("#consultant-registration-password")).toBeVisible();
  await expect(page.locator("#consultant-registration-verification")).toBeHidden();
  await page.locator("#consultant-password").fill("ConsultantPass2026!");
  await page.locator("#consultant-password-confirmation").fill("ConsultantPass2026!");
  await page.getByRole("button", { name: "Account activeren" }).click();
  await expect(page.locator("#consultant-register-success")).toHaveText("Je account is geactiveerd. Je kunt nu inloggen.");
  await expect(page.locator("#consultant-register-success")).toBeVisible();

  const account = await database!.query(
    "SELECT password, authorisatiecode FROM consultant WHERE username = $1",
    [username],
  );
  expect(account.rows[0].password).toBe("ConsultantPass2026!");
  expect(account.rows[0].authorisatiecode).toBeNull();

  const reusedCodeResponse = await page.request.post(
    new URL("/api/consultant/register", page.url()).toString(),
    {
      data: {
        username,
        authorisatiecode: authorizationCode,
        postcode,
        password: "AnotherPassword2026!",
        passwordConfirmation: "AnotherPassword2026!",
      },
    },
  );
  expect(reusedCodeResponse.status()).toBe(400);

  await login(page);
});
