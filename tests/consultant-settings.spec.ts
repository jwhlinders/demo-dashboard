import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";


const CONFIG = {
  clientUsername: process.env.E2E_CLIENT_USERNAME,
  anotherClientUsername: process.env.E2E_2ND_CLIENT_USERNAME,
  beheerder: {
    username: process.env.E2E_BEHEERDER_USERNAME,
    password: process.env.E2E_BEHEERDER_PASSWORD,
  },
  consultant: {
    username: process.env.E2E_CONSULTANT_USERNAME,
    password: process.env.E2E_CONSULTANT_PASSWORD,
  },
  requestIds: {
    client: randomUUID(),
    anotherClient: randomUUID(),
    consultant: randomUUID(),
  },
};

type PasswordResetRequest = {
  id: string;
  username: string;
  name: string | null;
  accountType: "client" | "consultant" | null;
};

type TestDatabasePool = {
  query: (sql: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};

const { Pool }: { Pool: new (options: { connectionString: string }) => TestDatabasePool } = require("pg");

let database: TestDatabasePool | undefined;
const newConsultantUsername = `pw-consultant-${Date.now()}`;
const secondConsultantUsername = `${newConsultantUsername}-2`;

async function login(page: Page, credentials: { username?: string; password?: string }) {
  test.skip(
    !CONFIG.beheerder.username
    || !CONFIG.beheerder.password
    || !CONFIG.consultant.username
    || !CONFIG.consultant.password
    || !CONFIG.clientUsername,
    "Set E2E_BEHEERDER_USERNAME/PASSWORD, E2E_CONSULTANT_USERNAME/PASSWORD, and E2E_CLIENT_USERNAME.",
  );

  await page.goto("/login");
  await page.locator("#username").fill(credentials.username!);
  await page.locator("#password").fill(credentials.password!);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function getPasswordResetRequest(page: Page, id: string): Promise<PasswordResetRequest> {
  const response = await page.request.get(
    new URL("/api/consultant/password-reset-requests", page.url()).toString(),
  );
  expect(response.ok()).toBeTruthy();

  const requests = await response.json() as PasswordResetRequest[];
  const request = requests.find((item) => item.id === id);
  if (!request) throw new Error(`Password-reset request ${id} was not returned by the consultant API.`);

  return request;
}

// Inserts requests for a client and another consultant.
test.beforeAll(async () => {
  test.skip(
    !CONFIG.beheerder.username
    || !CONFIG.beheerder.password
    || !CONFIG.consultant.username
    || !CONFIG.consultant.password
    || !CONFIG.clientUsername,
    "Set E2E_BEHEERDER_USERNAME/PASSWORD, E2E_CONSULTANT_USERNAME/PASSWORD, and E2E_CLIENT_USERNAME.",
  );

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for the settings integration test.");

  database = new Pool({ connectionString });
  await database.query(
    `INSERT INTO password_reset_requests (id, client_username)
     VALUES ($1, $2), ($3, $4), ($5, $6)`,
    [
      CONFIG.requestIds.client,
      CONFIG.clientUsername!,
      CONFIG.requestIds.consultant,
      CONFIG.consultant.username!,
      CONFIG.requestIds.anotherClient,
      CONFIG.anotherClientUsername!,
    ],
  );
});

test.afterAll(async () => {
  if (!database) return;

  try {
    await database.query(
      "DELETE FROM password_reset_requests WHERE client_username IN ($1, $2, $3)",
      [CONFIG.consultant.username!, CONFIG.clientUsername!, CONFIG.anotherClientUsername!],
    );
    const removedConsultants = await database.query(
      "DELETE FROM consultant WHERE username = ANY($1) RETURNING idadres",
      [[newConsultantUsername, secondConsultantUsername]],
    );
    const addressIds = removedConsultants.rows
      .map((consultant) => consultant.idadres)
      .filter((idadres) => idadres !== null);
    if (addressIds.length > 0) {
      await database.query("DELETE FROM adres WHERE idadres = ANY($1::integer[])", [addressIds]);
    }
  } finally {
    await database.end();
    database = undefined;
  }
});

async function expectResetRequestDisplayed(
  page: Page,
  id: string,
  username: string,
  accountType: "client" | "consultant",
  label: string,
) {


  const request = await getPasswordResetRequest(page, id);

  // DEBUG: Extract the JSON body from the response object asynchronously for DEBUG purposes
  // console.log(JSON.stringify(request, null, 2));

  expect(request.accountType).toBe(accountType);
  const item = page.locator("#password-reset-requests li").filter({ hasText: username });
  await expect(item).toContainText(`${request.name || request.username} (${username}) · ${label}`);
  await item.getByRole("button", { name: "In behandeling" }).click();
  await expect(item).toContainText("Status: In behandeling");
  await item.getByRole("button", { name: "Afgehandeld" }).click();
}

test("TC-01 Beheerder can handle a client's password-reset request", async ({ page }) => {
  await login(page, CONFIG.beheerder);
  await page.goto("/settings");

  await expectResetRequestDisplayed(
    page,
    CONFIG.requestIds.client,
    CONFIG.clientUsername!,
    "client",
    "Cliënt",
  );
});

test("TC-02 Beheerder can handle another consultant's password-reset request", async ({ page }) => {
  await login(page, CONFIG.beheerder);
  await page.goto("/settings");

  await expectResetRequestDisplayed(
    page,
    CONFIG.requestIds.consultant,
    CONFIG.consultant.username!,
    "consultant",
    "Consultant",
  );
});

test("TC-03 Consultant can handle a client's password-reset request", async ({ page }) => {
  await login(page, CONFIG.consultant);
  await page.goto("/settings");

  await expectResetRequestDisplayed(
    page,
    CONFIG.requestIds.anotherClient,
    CONFIG.anotherClientUsername!,
    "client",
    "Cliënt",
  );
});

test("TC-04 Consultant cannot add another consultant", async ({ page }) => {
  await login(page, CONFIG.consultant);
  await page.getByRole("button", { name: "Menu openen" }).click();
  await expect(page.locator("#manage-consultant-button")).toBeHidden();
  await page.goto("/settings");

  await expect(page.locator("#add-consultant-button")).toHaveCount(0);
  const response = await page.request.post(new URL("/api/consultants", page.url()).toString(), {
    data: {},
  });
  expect(response.status()).toBe(403);
  await page.goto("/beheer-consultant");
  await expect(page).toHaveURL(/\/$/);
});

test("TC-05 Beheerder can add a consultant and receives a stored authorization code", async ({ page }) => {
  await login(page, CONFIG.beheerder);
  await page.getByRole("button", { name: "Menu openen" }).click();
  const manageConsultantLink = page.locator("#manage-consultant-button");
  await expect(manageConsultantLink).toBeVisible();
  await expect(manageConsultantLink).toHaveAttribute("href", "/beheer-consultant");
  await manageConsultantLink.click();
  await expect(page).toHaveURL(/\/beheer-consultant$/);
  await expect(page.locator("#settings-title")).toHaveText("Nieuw consultant");
  await expect(page.locator("#setting-username")).toBeVisible();
  await expect(page.getByLabel("Tussenvoegsel")).toBeVisible();
  await expect(page.locator("#setting-first-name")).toHaveAttribute("maxlength", "20");
  await expect(page.locator("#setting-prefix")).toHaveAttribute("maxlength", "20");
  await expect(page.locator("#setting-last-name")).toHaveAttribute("maxlength", "40");
  const invalidNameResponse = await page.request.post(new URL("/api/consultants", page.url()).toString(), {
    data: { voornaam: "V".repeat(21), achternaam: "Bakker" },
  });
  expect(invalidNameResponse.status()).toBe(400);
  expect((await invalidNameResponse.json()).error).toContain("maximaal 20");

  await page.locator("#setting-first-name").fill("Playwright");
  await page.locator("#setting-prefix").fill("van der");
  await page.locator("#setting-last-name").fill("Consultant");
  await page.locator("#setting-email").fill(`new-consultant-${Date.now()}@example.invalid`);
  await page.locator("#setting-phone").fill("0612345678");
  await page.locator("#setting-home-street").fill("Teststraat 42");
  await page.locator("#setting-home-postcode").fill("1234 AB");
  await page.locator("#setting-home-city").fill("Amsterdam");
  await page.locator("#setting-username").fill(newConsultantUsername);
  await page.locator("#setting-role").fill("Behandelaar");
  await page.locator("#setting-default-location").selectOption({ index: 1 });
  await page.locator("#setting-start-werkdag").fill("09:00");
  await page.locator("#setting-einde-werkdag").fill("17:00");
  await page.locator('[data-weekday="Ma"]').check();
  await page.locator("#save-button").click();

  await expect(page.locator("#settings-status")).toHaveText("Consultant is aangemaakt. Bewaar de authorisatiecode.");
  const authorisatiecode = await page.locator("#setting-authorisatiecode").inputValue();
  expect(authorisatiecode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

  const storedCode = await database!.query(
    "SELECT authorisatiecode FROM consultant WHERE username = $1",
    [newConsultantUsername],
  );
  expect(storedCode.rows[0].authorisatiecode).toBe(authorisatiecode);
  const storedPassword = await database!.query(
    "SELECT password FROM consultant WHERE username = $1",
    [newConsultantUsername],
  );
  expect(storedPassword.rows[0].password).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  expect(storedPassword.rows[0].password).not.toBe("Welkom01");
  const storedName = await database!.query(
    "SELECT voornaam, tussenvoegsel, achternaam FROM consultant WHERE username = $1",
    [newConsultantUsername],
  );
  expect(storedName.rows[0]).toEqual({
    voornaam: "Playwright",
    tussenvoegsel: "van der",
    achternaam: "Consultant",
  });
  const storedAddress = await database!.query(`
    SELECT address.straat, address.postcode, address.woonplaats
    FROM consultant
    INNER JOIN adres AS address ON address.idadres = consultant.idadres
    WHERE consultant.username = $1
  `, [newConsultantUsername]);
  expect(storedAddress.rows[0]).toEqual({
    straat: "Teststraat 42",
    postcode: "1234AB",
    woonplaats: "Amsterdam",
  });
  await expect(page.locator("#setting-first-name")).not.toBeEditable();
  await expect(page.locator("#setting-home-street")).not.toBeEditable();
  await expect(page.locator("#setting-username")).not.toBeEditable();
  await expect(page.locator("#setting-authorisatiecode")).not.toBeEditable();
  await expect(page.locator("#setting-default-location")).toBeDisabled();
  await expect(page.locator('[data-weekday="Ma"]')).toBeDisabled();
  await expect(page.locator("#cancel-button")).toBeHidden();
  await expect(page.locator("#save-button")).toBeHidden();
  await expect(page.locator("#add-another-consultant-button")).toHaveText("Nieuw consultant");
  await expect(page.locator("#done-adding-consultants-button")).toHaveText("OK");

  await page.locator("#add-another-consultant-button").click();
  await expect(page.locator("#settings-title")).toHaveText("Nieuw consultant");
  await expect(page.locator("#setting-first-name")).toBeEditable();
  await expect(page.locator("#setting-first-name")).toHaveValue("");
  await expect(page.locator("#setting-username")).toHaveValue("");

  const longFirstName = "V".repeat(20);
  const longPrefix = "T".repeat(20);
  const longLastName = "A".repeat(40);
  await page.locator("#setting-first-name").fill(longFirstName);
  await page.locator("#setting-prefix").fill(longPrefix);
  await page.locator("#setting-last-name").fill(longLastName);
  await page.locator("#setting-email").fill(`new-consultant-${Date.now()}-2@example.invalid`);
  await page.locator("#setting-phone").fill("0612345678");
  await page.locator("#setting-home-street").fill("Dorpsstraat 8");
  await page.locator("#setting-home-postcode").fill("2345 BC");
  await page.locator("#setting-home-city").fill("Rotterdam");
  await page.locator("#setting-username").fill(secondConsultantUsername);
  await page.locator("#setting-role").fill("Behandelaar");
  await page.locator("#setting-default-location").selectOption({ index: 1 });
  await page.locator("#setting-start-werkdag").fill("09:00");
  await page.locator("#setting-einde-werkdag").fill("17:00");
  await page.locator('[data-weekday="Ma"]').check();
  await page.locator("#save-button").click();
  await expect(page.locator("#settings-status")).toHaveText("Consultant is aangemaakt. Bewaar de authorisatiecode.");
  await expect(page.locator("#setting-first-name")).not.toBeEditable();
  const savedLongName = await database!.query(
    "SELECT voornaam, tussenvoegsel, achternaam FROM consultant WHERE username = $1",
    [secondConsultantUsername],
  );
  expect(savedLongName.rows[0]).toEqual({
    voornaam: longFirstName,
    tussenvoegsel: longPrefix,
    achternaam: longLastName,
  });

  await page.locator("#done-adding-consultants-button").click();
  await expect(page).toHaveURL(/\/$/);
});

test("TC-06 Consultant can update and save address details", async ({ page }) => {
  await login(page, CONFIG.consultant);
  await page.goto("/settings");

  const originalResult = await database!.query(`
    SELECT consultant.idadres, address.straat, address.postcode, address.woonplaats
    FROM consultant
    LEFT JOIN adres AS address ON address.idadres = consultant.idadres
    WHERE consultant.username = $1
  `, [CONFIG.consultant.username!]);
  const original = originalResult.rows[0];
  const updated = {
    straat: "Voorbeeldstraat 77",
    postcode: "3456 CD",
    woonplaats: "Gouda",
  };

  try {
    await page.locator("#setting-home-street").fill(updated.straat);
    await page.locator("#setting-home-postcode").fill(updated.postcode);
    await page.locator("#setting-home-city").fill(updated.woonplaats);
    await page.locator("#save-button").click();
    await expect(page.locator("#settings-status")).toHaveText("Instellingen zijn opgeslagen.");

    const settingsResponse = await page.request.get(new URL("/api/consultant/settings", page.url()).toString());
    expect(settingsResponse.ok()).toBeTruthy();
    const saved = await settingsResponse.json();
    expect(saved.address_street).toBe(updated.straat);
    expect(saved.address_postcode).toBe("3456CD");
    expect(saved.address_city).toBe(updated.woonplaats);
  } finally {
    const currentResult = await database!.query(
      "SELECT idadres FROM consultant WHERE username = $1",
      [CONFIG.consultant.username!],
    );
    const currentAddressId = currentResult.rows[0]?.idadres;
    await database!.query(
      "UPDATE consultant SET idadres = $1 WHERE username = $2",
      [original.idadres, CONFIG.consultant.username!],
    );
    if (original.idadres !== null) {
      await database!.query(
        "UPDATE adres SET straat = $1, postcode = $2, woonplaats = $3 WHERE idadres = $4",
        [original.straat, original.postcode, original.woonplaats, original.idadres],
      );
    }
    if (currentAddressId !== null && currentAddressId !== original.idadres) {
      await database!.query(`
        DELETE FROM adres
        WHERE idadres = $1
          AND NOT EXISTS (SELECT 1 FROM consultant WHERE idadres = $1)
          AND NOT EXISTS (SELECT 1 FROM klanten WHERE idadres = $1)
      `, [currentAddressId]);
    }
  }
});
