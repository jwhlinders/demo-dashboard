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
  query: (sql: string, values: unknown[]) => Promise<unknown>;
  end: () => Promise<void>;
};

const { Pool }: { Pool: new (options: { connectionString: string }) => TestDatabasePool } = require("pg");

let database: TestDatabasePool | undefined;

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
