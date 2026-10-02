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

async function getAppointmentData(page) {
  const clientSelect = page.locator("#appointment-client");
  await expect(clientSelect).toBeEnabled();
  await expect(clientSelect.locator("option").nth(1)).toBeAttached();
  const clientName = (await clientSelect.locator("option").nth(1).textContent()).trim();

  const appointmentDate = new Date();
  appointmentDate.setDate(appointmentDate.getDate() + 1);
  while (appointmentDate.getDay() === 0 || appointmentDate.getDay() === 6) {
    appointmentDate.setDate(appointmentDate.getDate() + 1);
  }
  const dateValue = [appointmentDate.getFullYear(), String(appointmentDate.getMonth() + 1).padStart(2, "0"), String(appointmentDate.getDate()).padStart(2, "0")].join("-");
  const notes = `Playwright appointment ${Date.now()}`;

  return { clientSelect, clientName, dateValue, notes };
}

async function deleteAppointment(page, id) {
  const response = await page.request.delete(new URL(`/api/appointments/${id}`, page.url()).toString());
  expect(response.status()).toBe(204);
}

test.beforeEach(async ({ page }) => {
  await loginAsConsultant(page);
});

test("consultant can log in and see their name", async ({ page }) => {
  const response = await page.request.get(new URL("/api/consultant", page.url()).toString());
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json();

  expect(consultant.name).toBeTruthy();
  expect(consultant.name).not.toBe("Agenda");
  expect(consultant.locationName).toBeTruthy();
  await expect(page.locator("#consultant-name")).toHaveText(consultant.name);
  await expect(page.locator("#consultant-location")).toHaveText(`Locatie: ${consultant.locationName}`);
});

test("consultant can open the settings page", async ({ page }) => {
  await expect(page.locator("#settings-button")).toBeVisible();
  await page.locator("#settings-button").click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator("#settings-title")).toHaveText("Instellingen");

  const response = await page.request.get(new URL("/api/consultant/settings", page.url()).toString());
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json();
  expect(consultant.username).toBeTruthy();
  expect(consultant.password).toBe("********");
  await expect(page.locator("#consultant-name")).toContainText(`(${consultant.username})`);
});

test("consultant can add a new appointment", async ({ page }) => {
  const { clientSelect, clientName, dateValue, notes } = await getAppointmentData(page);
  await page.locator("#appointment-date").fill(dateValue);
  await clientSelect.selectOption({ index: 1 });
  await page.locator("#appointment-hour").selectOption("10");
  await page.locator("#appointment-minute").selectOption("15");
  await page.locator("#appointment-duration").fill("30");
  await page.locator("#appointment-notes").fill(notes);

  const createResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/appointments") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Afspraak opslaan" }).click();
  const response = await createResponse;
  expect(response.status()).toBe(201);
  const appointment = await response.json();

  try {
    expect(appointment.client).toBe(clientName);
    expect(appointment.clientUsername).toBeTruthy();
    expect(appointment.date).toBe(dateValue);
    expect(appointment.start).toBe("10:15");
    expect(appointment.notes).toBe(notes);
  } finally {
    await deleteAppointment(page, appointment.id);
  }
});

test("consultant can see an appointment in the agenda", async ({ page }) => {
  const { clientName, dateValue, notes } = await getAppointmentData(page);
  const createResponse = await page.request.post(new URL("/api/appointments", page.url()).toString(), {
    data: { date: dateValue, client: clientName, start: "10:15", durationMinutes: 30, notes },
  });
  expect(createResponse.status()).toBe(201);
  const appointment = await createResponse.json();

  try {
    await page.reload();
    const clientFilterValues = await page.locator("#agenda-client-filter option").evaluateAll((options) =>
      options.map((option) => option.value.trim().toLocaleLowerCase("nl-NL")).filter(Boolean),
    );
    expect(new Set(clientFilterValues).size).toBe(clientFilterValues.length);
    const today = new Date();
    const appointmentDate = new Date(`${dateValue}T00:00:00`);
    const monday = (date) => {
      const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      return weekStart;
    };
    if (monday(appointmentDate) > monday(today)) await page.locator("#next-week").click();

    const appointmentCard = page.locator(".appointment-card").filter({ hasText: notes });
  await expect(appointmentCard).toHaveCount(1);
    await expect(appointmentCard).toContainText(clientName);
    await expect(appointmentCard).toContainText("10:15 - 10:45");
    await expect(appointmentCard).toContainText(notes);
  } finally {
    await deleteAppointment(page, appointment.id);
  }
});
