import { test, expect, type Page, type Locator } from '@playwright/test';
import { formatDateInput, formatISODate, nextScheduledWorkday } from './helpers/date-time';

async function loginAsConsultant(page: Page) {
  const username = process.env.E2E_CONSULTANT_USERNAME;
  const password = process.env.E2E_CONSULTANT_PASSWORD;
  test.skip(!username || !password, "Set E2E_CONSULTANT_USERNAME and E2E_CONSULTANT_PASSWORD to run this test.");

  // Type Guard: TypeScript snapt nu dat 'username' en 'password' vanaf hier gegarandeerd strings zijn
  if (!username || !password) return;

  await page.goto("/login");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function deleteAppointment(page: Page, id: string) {
  const response = await page.request.delete(new URL(`/api/appointments/${id}`, page.url()).toString());
  expect(response.status()).toBe(204);
}

test.beforeEach(async ({ page }) => {
  await loginAsConsultant(page);
});

test("client can request an appointment with a consultant at a standard location", async ({ browser, page }) => {
  const username = process.env.E2E_CLIENT_USERNAME;
  const password = process.env.E2E_CLIENT_PASSWORD;
  test.skip(!username || !password, "Set E2E_CLIENT_USERNAME and E2E_CLIENT_PASSWORD to run this test.");

  const requestedCountBefore = Number(await page.locator("#requested-count").textContent());
  const clientContext = await browser.newContext();
  const clientPage = await clientContext.newPage();
  let appointment;
  try {
    await clientPage.goto(new URL("/login", page.url()).toString());
    await clientPage.locator("#username").fill(username!);
    await clientPage.locator("#password").fill(password!);
    await clientPage.getByRole("button", { name: "Inloggen" }).click();
    await expect(clientPage).toHaveURL(/\/dashboard$/);

    const profileResponse = await clientPage.request.get(new URL("/api/profile", page.url()).toString());
    expect(profileResponse.ok()).toBeTruthy();
    const clientProfile = await profileResponse.json();

    const optionsResponse = await clientPage.request.get(new URL("/api/appointment-options", page.url()).toString());
    expect(optionsResponse.ok()).toBeTruthy();

    // 1. Cast de JSON-output direct naar de juiste structuur (slechts één keer aanroepen!)
    // Voeg 'werkdagen' toe aan de type-declaratie van de consultants
    const options = await optionsResponse.json() as {
      consultants: Array<{
        username: string;
        name: string;
        locationId: string | number;
        werkdagen?: string | number;
      }>;
      locations: Array<{ id: string | number }>;
    };

    expect(options.locations.length).toBeGreaterThan(0);

    // TypeScript herkent 'item.username' nu vlekkeloos
    expect(new Set(options.consultants.map((item) => item.username.trim().toLocaleLowerCase("nl-NL"))).size).toBe(options.consultants.length);

    const consultantResponse = await page.request.get(new URL("/api/consultant/settings", page.url()).toString());
    expect(consultantResponse.ok()).toBeTruthy();

    // 2. Cast ook deze response zodat 'username' bekend is op dit object
    const loggedInConsultant = await consultantResponse.json() as { username: string };

    const consultant = options.consultants.find((item) => item.username === loggedInConsultant.username);
    expect(consultant).toBeTruthy();
    if (!consultant) throw new Error(`Consultant ${loggedInConsultant.username} was not found in appointment options.`);

    // 3. Gebruik een uitroepteken (!) achter consultant omdat we hierboven al hebben gecheckt dat hij bestaat
    const location = options.locations.find((item) => String(item.id) === String(consultant.locationId));
    expect(location).toBeTruthy();
    if (!location) throw new Error(`No location found for consultant ${consultant.username}.`);

    await expect(clientPage.locator("#appointment-location")).toBeVisible();
    await clientPage.locator("#appointment-location").selectOption(String(location.id));
    await clientPage.locator("#appointment-consultant").selectOption(consultant.username);
    const consultantWorkdays = String(consultant.werkdagen || "");
    test.skip(!consultantWorkdays, "The selected consultant has no configured workdays.");
    const appointmentDate = nextScheduledWorkday(new Date(), consultantWorkdays);
    const dateValue = formatISODate(appointmentDate);
    const reason = `Playwright request ${Date.now()}`;

    const dateInput = clientPage.locator("#appointment-date");
    const formattedAppointmentDate = formatDateInput(appointmentDate);
    await dateInput.fill(formattedAppointmentDate.replaceAll("-", ""));
    await expect(dateInput).toHaveValue(formattedAppointmentDate);
    await clientPage.locator("#appointment-hour").selectOption("10");
    await clientPage.locator("#appointment-minute").selectOption("00");
    await clientPage.locator("#appointment-notes").fill(reason);

    const createResponse = clientPage.waitForResponse((response) =>
      response.url().endsWith("/api/appointments") && response.request().method() === "POST",
    );
    await clientPage.getByRole("button", { name: "Aanvraag versturen" }).click();
    const response = await createResponse;
    expect(response.status()).toBe(201);
    appointment = await response.json();
    expect(appointment.date).toBe(dateValue);
    expect(appointment.clientUsername).toBe(clientProfile.username);
    expect(appointment.durationMinutes).toBe(30);
    expect(appointment.notes).toBe(reason);
    expect(appointment.aangevraagd).toBe(true);
    await expect(clientPage.locator("#storage-status")).toContainText("wacht op bevestiging");
    await expect(clientPage.locator("#requested-summary")).toBeHidden();
    await expect(clientPage.getByRole("button", { name: "Aanvraag versturen" })).toBeVisible();
    await expect(clientPage.locator(".appointment-card").filter({ hasText: reason })).toContainText(consultant.name);

    await page.reload();
    await expect.poll(async () => Number(await page.locator("#requested-count").textContent())).toBe(requestedCountBefore + 1);
    await page.locator("#requested-summary-button").click();
    const appointmentCard = page.locator(".appointment-card").filter({ hasText: reason });
    await expect(appointmentCard).toBeVisible();
    const confirmButton = appointmentCard.getByRole("button", { name: "Status: aangevraagd" });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();
    await expect(appointmentCard).toContainText("Status: definitief");
    await expect(appointmentCard.getByRole("button", { name: "Status: aangevraagd" })).toHaveCount(0);
  } finally {
    if (appointment) await deleteAppointment(page, appointment.id);
    await clientContext.close();
  }
});
