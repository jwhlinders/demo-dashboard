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

function formatDate(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
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
    await clientPage.locator("#username").fill(username);
    await clientPage.locator("#password").fill(password);
    await clientPage.getByRole("button", { name: "Inloggen" }).click();
    await expect(clientPage).toHaveURL(/\/$/);

    const profileResponse = await clientPage.request.get(new URL("/api/profile", page.url()).toString());
    expect(profileResponse.ok()).toBeTruthy();
    const clientProfile = await profileResponse.json();
    const optionsResponse = await clientPage.request.get(new URL("/api/appointment-options", page.url()).toString());
    expect(optionsResponse.ok()).toBeTruthy();
    const options = await optionsResponse.json();
    expect(options.locations.length).toBeGreaterThan(0);
    expect(new Set(options.consultants.map((item) => item.username.trim().toLocaleLowerCase("nl-NL"))).size).toBe(options.consultants.length);
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
    const dateInput = clientPage.locator("#appointment-date");
    const datePicker = clientPage.locator("#appointment-date-picker");
    const today = formatDate(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await expect(datePicker).toHaveAttribute("min", today);
    const [yesterdayYear, yesterdayMonth, yesterdayDay] = formatDate(yesterday).split("-");
    await dateInput.fill(`${yesterdayDay}${yesterdayMonth}${yesterdayYear}`);
    await dateInput.blur();
    await expect(dateInput).toHaveValue(formatDate(new Date()).split("-").reverse().join("-"));
    await expect(clientPage.locator("#appointment-date-error")).toHaveText("Een datum in het verleden is niet toegestaan.");
    const [year, month, day] = dateValue.split("-");
    await dateInput.fill(`${day}${month}${year}`);
    await expect(dateInput).toHaveValue(`${day}-${month}-${year}`);
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
