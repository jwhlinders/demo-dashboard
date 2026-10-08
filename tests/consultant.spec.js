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
  const consultantResponse = await page.request.get(new URL("/api/consultant", page.url()).toString());
  expect(consultantResponse.ok()).toBeTruthy();
  const consultant = await consultantResponse.json();
  test.skip(!consultant.werkdagen, "The consultant has no configured workdays.");

  const appointmentDate = new Date();
  appointmentDate.setDate(appointmentDate.getDate() + 1);
  const weekdayNames = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];
  while (!String(consultant.werkdagen || "").includes(weekdayNames[appointmentDate.getDay()])) {
    appointmentDate.setDate(appointmentDate.getDate() + 1);
  }
  const dateValue = [appointmentDate.getFullYear(), String(appointmentDate.getMonth() + 1).padStart(2, "0"), String(appointmentDate.getDate()).padStart(2, "0")].join("-");
  const notes = `Playwright appointment ${Date.now()}`;

  return { clientSelect, clientName, dateValue, notes, werkdagen: consultant.werkdagen };
}

function formatDate(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
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
  for (const weekday of ["Ma", "Di", "Wo", "Do", "Vr"]) {
    const isWorkday = consultant.werkdagen.toLocaleLowerCase("nl-NL").includes(weekday.toLocaleLowerCase("nl-NL"));
    const checkbox = page.locator(`[data-weekday="${weekday}"]`);
    await expect(checkbox).toBeChecked({ checked: isWorkday });
  }

  const mondayWasEnabled = consultant.werkdagen.includes("Ma");
  const monday = page.locator('[data-weekday="Ma"]');
  try {
    await monday.uncheck();
    await page.locator("#save-button").click();
    await expect(page.locator("#settings-status")).toHaveText("Werkdagen zijn opgeslagen.");
    const updatedResponse = await page.request.get(new URL("/api/consultant/settings", page.url()).toString());
    const updatedConsultant = await updatedResponse.json();
    expect(updatedConsultant.werkdagen.includes("Ma")).toBe(false);
    await expect(monday).not.toBeChecked();
  } finally {
    if (mondayWasEnabled) await monday.check();
    await page.locator("#save-button").click();
    await expect(page.locator("#settings-status")).toHaveText("Werkdagen zijn opgeslagen.");
  }
});

test("consultant can add an appointment on a workday", async ({ page }) => {
  const { clientSelect, clientName, dateValue, notes } = await getAppointmentData(page);
  const datePicker = page.locator("#appointment-date-picker");
  await datePicker.click();
  for (let month = 0; month < 2 && await page.locator(`#appointment-date-calendar [data-date="${dateValue}"]`).count() === 0; month += 1) {
    await page.locator("[data-calendar-next]").click();
  }
  const workdayButton = page.locator(`#appointment-date-calendar [data-date="${dateValue}"]`);
  await expect(workdayButton).toBeEnabled();
  await workdayButton.click();

  const dateInput = page.locator("#appointment-date");
  const [year, month, day] = dateValue.split("-");
  await expect(dateInput).toHaveValue(`${day}-${month}-${year}`);
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

test("consultant sees an error for a past date", async ({ page }) => {
  const { dateValue } = await getAppointmentData(page);
  const dateInput = page.locator("#appointment-date");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const [year, month, day] = dateValue.split("-");
  await dateInput.fill(`${day}-${month}-${year}`);
  await dateInput.evaluate((input) => input.setSelectionRange(2, 2));
  await dateInput.press("Backspace");
  await expect(dateInput).toHaveValue(`${day[0]}_-${month}-${year}`);
  await dateInput.fill(`${day}-${month}-${year}`);
  await dateInput.evaluate((input) => input.setSelectionRange(0, 0));
  await dateInput.press("Delete");
  await expect(dateInput).toHaveValue(`_${day[1]}-${month}-${year}`);
  await dateInput.fill(`${day}-${month}-${year}`);
  await dateInput.evaluate((input) => input.setSelectionRange(0, 2));
  await dateInput.pressSequentially("11");
  await expect(dateInput).toHaveValue(`11-${month}-${year}`);

  const [yesterdayYear, yesterdayMonth, yesterdayDay] = formatDate(yesterday).split("-");
  await dateInput.fill(`${yesterdayDay}${yesterdayMonth}${yesterdayYear}`);
  await dateInput.blur();
  await expect(dateInput).toHaveValue(formatDate(new Date()).split("-").reverse().join("-"));
  await expect(page.locator("#appointment-date-error")).toHaveText("Een datum in het verleden is niet toegestaan.");
  await dateInput.fill("48012026");
  await expect(dateInput).toHaveValue("48-01-2026");
  await expect.poll(() => dateInput.evaluate((input) => input.validationMessage))
    .toBe("Vul een geldige datum in als dd-mm-jjjj.");
  await dateInput.blur();
  await expect(dateInput).toHaveValue(formatDate(new Date()).split("-").reverse().join("-"));
  await expect(page.locator("#appointment-date-error")).toHaveText("De ingevoerde datum is ongeldig");
});

test("consultant sees an error for a non-workday", async ({ page }) => {
  const { clientName, werkdagen } = await getAppointmentData(page);
  const dateInput = page.locator("#appointment-date");
  const datePicker = page.locator("#appointment-date-picker");
  const unavailableDate = new Date();
  unavailableDate.setDate(unavailableDate.getDate() + 1);
  const weekdayNames = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];
  while (werkdagen.includes(weekdayNames[unavailableDate.getDay()])) unavailableDate.setDate(unavailableDate.getDate() + 1);
  const unavailableDateValue = formatDate(unavailableDate);
  await datePicker.click();
  for (let monthIndex = 0; monthIndex < 2 && await page.locator(`#appointment-date-calendar [data-date="${unavailableDateValue}"]`).count() === 0; monthIndex += 1) {
    await page.locator("[data-calendar-next]").click();
  }
  await expect(page.locator(`#appointment-date-calendar [data-date="${unavailableDateValue}"]`)).toBeDisabled();

  const [unavailableYear, unavailableMonth, unavailableDay] = unavailableDateValue.split("-");
  const unavailableResponse = await page.request.post(new URL("/api/appointments", page.url()).toString(), {
    data: { date: unavailableDateValue, client: clientName, start: "10:15", durationMinutes: 30, notes: "" },
  });
  expect(unavailableResponse.status()).toBe(400);
  expect(await unavailableResponse.json()).toEqual({
    error: `consultant niet aanwezig op ${unavailableDay}-${unavailableMonth}-${unavailableYear}`,
  });
  await dateInput.fill(`${unavailableDay}${unavailableMonth}${unavailableYear}`);
  await dateInput.blur();
  await expect(page.locator("#appointment-date-error")).toHaveText(`consultant niet aanwezig op ${unavailableDay}-${unavailableMonth}-${unavailableYear}`);
});

test("consultant cannot create an appointment in the past", async ({ page }) => {
  const { clientName } = await getAppointmentData(page);
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 1);
  while (pastDate.getDay() === 0 || pastDate.getDay() === 6) pastDate.setDate(pastDate.getDate() - 1);
  const response = await page.request.post(new URL("/api/appointments", page.url()).toString(), {
    data: { date: formatDate(pastDate), client: clientName, start: "10:15", durationMinutes: 30, notes: "" },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ error: "Afspraken in het verleden zijn niet toegestaan." });
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
    expect(clientFilterValues).toContain(clientName.trim().toLocaleLowerCase("nl-NL"));
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
