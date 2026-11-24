import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Page, type Locator } from '@playwright/test';

type TestDatabasePool = {
  query: (sql: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end: () => Promise<void>;
};

const { Pool }: { Pool: new (options: { connectionString: string }) => TestDatabasePool } = require("pg");

test("Status aanvragen navigeert naar de statuspagina voor wachtwoordaanvragen", async ({ page }) => {
  await page.goto("/password-reset-request");

  await page.getByRole("link", { name: "Status aanvragen" }).click();

  await expect(page).toHaveURL(/\/password-reset-status$/);
  await expect(page.getByRole("heading", { name: "Aanvraagstatus bekijken" })).toBeVisible();
});

test("vult de gebruikersnaam niet automatisch in vanuit het inlogscherm", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => sessionStorage.setItem("passwordResetUsername", "bestaande-gebruiker"));
  await page.goto("/password-reset-request");

  const username = page.locator("#request-username");
  await expect(username).toHaveValue("");
  await expect(username).not.toHaveAttribute("readonly");
  await username.fill("andere-gebruiker");
  await expect(username).toHaveValue("andere-gebruiker");
});

test("TC01: verbergt de verzendknop nadat de statuscode is getoond", async ({ page }) => {
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

test("TC02: toont een melding en houdt de knop zichtbaar na een recente aanvraag", async ({ page }) => {
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

test("TC03: staat een nieuwe aanvraag toe als het wachtwoord van een recente aanvraag is gewijzigd", async ({ page }) => {
  const connectionString = process.env.DATABASE_URL;
  test.skip(!connectionString, "DATABASE_URL is required for this database integration test.");

  const database = new Pool({ connectionString: connectionString! });
  const username = `password-reset-${randomUUID()}`;
  try {
    await database.query(
      "INSERT INTO password_reset_requests (id, client_username, password_changed_at) VALUES ($1, $2, NOW())",
      [randomUUID(), username],
    );
    await page.goto("/password-reset-request");

    const response = await page.request.post("/api/password-reset-requests", {
      data: { username },
    });

    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.alreadySubmitted).toBeUndefined();
    expect(result.trackingCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  } finally {
    await database.query(
      "DELETE FROM password_reset_requests WHERE LOWER(client_username) = LOWER($1)",
      [username],
    );
    await database.end();
  }
});

test("kan het wachtwoord van een consultant herstellen", async ({ page }) => {
  const connectionString = process.env.DATABASE_URL;
  test.skip(!connectionString, "DATABASE_URL is required for this database integration test.");

  const database = new Pool({ connectionString: connectionString! });
  const username = `password-reset-consultant-${randomUUID()}`;
  const trackingCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const trackingCode = Array.from(
    randomBytes(8),
    (byte) => trackingCodeAlphabet[byte % trackingCodeAlphabet.length],
  ).join("");
  const trackingCodeHash = createHash("sha256").update(trackingCode).digest("hex");
  const resetRequestId = randomUUID();

  try {
    await database.query(
      "INSERT INTO consultant (achternaam, email, username, password) VALUES ($1, $2, $3, $4)",
      ["Resettest", `${username}@example.invalid`, username, "OudWachtwoord123"],
    );
    await database.query(
      `INSERT INTO password_reset_requests (id, client_username, tracking_token_hash, status, handled_at)
       VALUES ($1, $2, $3, 'afgehandeld', NOW())`,
      [resetRequestId, username, trackingCodeHash],
    );

    const response = await page.request.post("/api/password-reset-complete", {
      data: {
        username,
        trackingCode,
        password: "NieuwWachtwoord123!",
        passwordConfirmation: "NieuwWachtwoord123!",
      },
    });

    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      message: "Je wachtwoord is gewijzigd. Je kunt nu inloggen.",
    });

    const loginResponse = await page.request.post("/api/login", {
      data: { username, password: "NieuwWachtwoord123!" },
    });
    expect(loginResponse.ok()).toBeTruthy();
  } finally {
    await database.query("DELETE FROM password_reset_requests WHERE id = $1", [resetRequestId]);
    await database.query("DELETE FROM consultant WHERE username = $1", [username]);
    await database.end();
  }
});

test("TC04: meldt dat er geen lopende aanvraag is als het wachtwoord al is gewijzigd", async ({ page }) => {
  await page.route("**/api/password-reset-status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ status: "wachtwoord_gewijzigd" }),
  }));

  await page.goto("/password-reset-status");
  await page.locator("#reset-username").fill("testgebruiker");
  await page.locator("#tracking-code").fill("ABCD2345");

  await expect(page.locator("#request-status")).toHaveText(
    "Er is geen lopende aanvraag bekend: het wachtwoord is al gewijzigd. Je kunt nu inloggen.",
  );
  await expect(page.locator("#create-password-button")).toBeDisabled();
  await expect(page.locator("#new-password")).toBeDisabled();
  await expect(page.locator("#confirm-password")).toBeDisabled();
});

test("TC05: meldt dat er geen lopende aanvraag is voor de ingevulde gebruikersnaam en statuscode", async ({ page }) => {
  await page.route("**/api/password-reset-status", (route) => route.fulfill({
    status: 404,
    contentType: "application/json",
    body: JSON.stringify({ error: "Geen aanvraag gevonden met deze statuscode." }),
  }));

  await page.goto("/password-reset-status");
  await page.locator("#reset-username").fill("testgebruiker");
  await page.locator("#tracking-code").fill("ABCD2345");

  await expect(page.locator("#request-status")).toHaveText(
    "Er is geen lopende aanvraag bekend met deze gebruikersnaam en statuscode.",
  );
  await expect(page.locator("#status-error")).toBeHidden();
  await expect(page.locator("#new-password")).toBeDisabled();
  await expect(page.locator("#confirm-password")).toBeDisabled();
});

test("TC06: toont een bevestiging na het wijzigen en redirect naar inlogscherm", async ({ page }) => {
  await page.route("**/api/password-reset-status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ status: "afgehandeld" }),
  }));
  await page.route("**/api/password-reset-complete", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ message: "Je wachtwoord is gewijzigd. Je kunt nu inloggen." }),
  }));

  await page.goto("/password-reset-status");
  await expect(page.locator("#new-password")).toBeDisabled();
  await expect(page.locator("#confirm-password")).toBeDisabled();
  await page.locator("#reset-username").fill("testgebruiker");
  await page.locator("#tracking-code").fill("ABCD2345");
  await expect(page.locator("#request-status")).toHaveText(
    "Afgehandeld: je kunt nu hieronder een nieuw wachtwoord instellen.",
  );
  await expect(page.locator("#new-password")).toBeEnabled();
  await expect(page.locator("#confirm-password")).toBeEnabled();
  await page.locator("#new-password").fill("SterkWachtwoord123");
  await page.locator("#confirm-password").fill("SterkWachtwoord123");
  await page.getByRole("button", { name: "Aanmaken wachtwoord" }).click();

  const confirmationDialog = page.locator("#password-reset-confirmation-dialog");
  await expect(confirmationDialog).toBeVisible();
  await expect(confirmationDialog).toContainText("Je wachtwoord is gewijzigd. Je kunt nu inloggen.");
  await confirmationDialog.getByRole("button", { name: "OK" }).click();

  await expect(page).toHaveURL(/\/login$/);
});

test("toont een foutmelding als het wijzigen van het wachtwoord mislukt", async ({ page }) => {
  await page.route("**/api/password-reset-status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ status: "afgehandeld" }),
  }));
  await page.route("**/api/password-reset-complete", (route) => route.fulfill({
    status: 400,
    contentType: "application/json",
    body: JSON.stringify({ error: "Kies een nieuw wachtwoord van 8 tot 128 tekens." }),
  }));

  await page.goto("/password-reset-status");
  await page.locator("#reset-username").fill("testgebruiker");
  await page.locator("#tracking-code").fill("ABCD2345");
  await page.locator("#new-password").fill("SterkWachtwoord123");
  await page.locator("#confirm-password").fill("SterkWachtwoord123");
  await page.getByRole("button", { name: "Aanmaken wachtwoord" }).click();

  await expect(page.locator("#status-error")).toHaveText("Kies een nieuw wachtwoord van 8 tot 128 tekens.");
  await expect(page.locator("#status-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aanmaken wachtwoord" })).toBeEnabled();
});

test("toont een bevestiging na het wijzigen van een tijdelijk wachtwoord en gaat daarna naar inloggen", async ({ page }) => {
  await page.route("**/change-password", async (route) => {
    if (new URL(route.request().url()).pathname !== "/change-password") return route.continue();
    await route.fulfill({
      contentType: "text/html",
      body: readFileSync(resolve(process.cwd(), "src", "change-password.html"), "utf8"),
    });
  });
  await page.route("**/api/change-password", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ username: "testgebruiker" }) });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ message: "Je wachtwoord is gewijzigd. Je kunt nu inloggen." }),
    });
  });

  await page.goto("/change-password");
  await expect(page.locator("#password-username")).toHaveValue("testgebruiker");
  await page.locator("#new-password").fill("SterkWachtwoord123");
  await page.locator("#confirm-password").fill("SterkWachtwoord123");
  await page.getByRole("button", { name: "Wachtwoord opslaan" }).click();

  const confirmationDialog = page.locator("#password-change-confirmation-dialog");
  await expect(confirmationDialog).toBeVisible();
  await expect(confirmationDialog).toContainText("Je wachtwoord is gewijzigd. Je kunt nu inloggen.");
  await confirmationDialog.getByRole("button", { name: "OK" }).click();

  await expect(page).toHaveURL(/\/login$/);
});

test("toont een foutmelding als het opslaan van een tijdelijk wachtwoord mislukt", async ({ page }) => {
  await page.route("**/change-password", async (route) => {
    if (new URL(route.request().url()).pathname !== "/change-password") return route.continue();
    await route.fulfill({
      contentType: "text/html",
      body: readFileSync(resolve(process.cwd(), "src", "change-password.html"), "utf8"),
    });
  });
  await page.route("**/api/change-password", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ username: "testgebruiker" }) });
    }
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Kies een nieuw wachtwoord van 8 tot 128 tekens." }),
    });
  });

  await page.goto("/change-password");
  await page.locator("#new-password").fill("SterkWachtwoord123");
  await page.locator("#confirm-password").fill("SterkWachtwoord123");
  await page.getByRole("button", { name: "Wachtwoord opslaan" }).click();

  await expect(page.locator("#password-error")).toHaveText("Kies een nieuw wachtwoord van 8 tot 128 tekens.");
  await expect(page.locator("#password-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Wachtwoord opslaan" })).toBeEnabled();
});
