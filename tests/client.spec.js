const { test, expect } = require("@playwright/test");

async function loginAsConsultant(page) {
  const username = process.env.E2E_CONSULTANT_USERNAME;
  const password = process.env.E2E_CONSULTANT_PASSWORD;
  test.skip(!username || !password, "Set E2E_CONSULTANT_USERNAME and E2E_CONSULTANT_PASSWORD to run this test.");

  await page.goto("/login");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function deleteAppointment(page, id) {
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

  const clientContext = await browser.newContext();
  const clientPage = await clientContext.newPage();
  let appointment;
  try {
    await clientPage.goto(new URL("/login", page.url()).toString());
    await clientPage.locator("#username").fill(username);
    await clientPage.locator("#password").fill(password);
    await clientPage.getByRole("button", { name: "Inloggen" }).click();
    await expect(clientPage).toHaveURL(/\/$/);

    const optionsResponse = await clientPage.request.get(new URL("/api/appointment-options", page.url()).toString());
    expect(optionsResponse.ok()).toBeTruthy();
    const options = await optionsResponse.json();
    expect(options.locations.length).toBeGreaterThan(0);
    const consultantResponse = await page.request.get(new URL("/api/consultant/settings", page.url()).toString());
    expect(consultantResponse.ok()).toBeTruthy();
    const loggedInConsultant = await consultantResponse.json();
    const consultant = options.consultants.find((item) => item.username === loggedInConsultant.username);
    expect(consultant).toBeTruthy();
    const location = options.locations.find((item) => String(item.id) === String(consultant.locationId));
    expect(location).toBeTruthy();

    const appointmentDate = new Date();
    appointmentDate.setDate(appointmentDate.getDate() + 1);
    while (appointmentDate.getDay() === 0 || appointmentDate.getDay() === 6) appointmentDate.setDate(appointmentDate.getDate() + 1);
    const dateValue = [appointmentDate.getFullYear(), String(appointmentDate.getMonth() + 1).padStart(2, "0"), String(appointmentDate.getDate()).padStart(2, "0")].join("-");
    const reason = `Playwright request ${Date.now()}`;

    await expect(clientPage.locator("#appointment-location")).toBeVisible();
    await clientPage.locator("#appointment-date").fill(dateValue);
    await clientPage.locator("#appointment-hour").selectOption("10");
    await clientPage.locator("#appointment-minute").selectOption("00");
    await clientPage.locator("#appointment-location").selectOption(String(location.id));
    await clientPage.locator("#appointment-consultant").selectOption(consultant.username);
    await clientPage.locator("#appointment-notes").fill(reason);

    const createResponse = clientPage.waitForResponse((response) =>
      response.url().endsWith("/api/appointments") && response.request().method() === "POST",
    );
    await clientPage.getByRole("button", { name: "Aanvraag versturen" }).click();
    const response = await createResponse;
    expect(response.status()).toBe(201);
    appointment = await response.json();
    expect(appointment.date).toBe(dateValue);
    expect(appointment.durationMinutes).toBe(30);
    expect(appointment.notes).toBe(reason);
    expect(appointment.aangevraagd).toBe(true);
    await expect(clientPage.locator("#storage-status")).toContainText("wacht op bevestiging");
    await expect(clientPage.getByRole("button", { name: "Aanvraag versturen" })).toBeVisible();
    await expect(clientPage.locator(".appointment-card").filter({ hasText: reason })).toContainText(consultant.name);

    await page.reload();
    const monday = (date) => {
      const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      return weekStart;
    };
    if (monday(appointmentDate) > monday(new Date())) await page.locator("#next-week").click();
    const appointmentCard = page.locator(".appointment-card").filter({ hasText: reason });
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
