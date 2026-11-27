import { test, expect, type Page, type Locator } from '@playwright/test';

type Consultant = {
  werkdagen: string | null;
};

type WorkLocation = {
  id: number;
  naam: string;
  adres: string | null;
  postcode: string | null;
  plaats: string | null;
};

type AppointmentData = {
  clientSelect: Locator;
  clientName: string;
  dateValue: string;
  notes: string;
  werkdagen: string;
};

type CreatedAppointment = {
  id: string;
  client: string;
  clientUsername: string;
  date: string;
  start: string;
  notes: string;
};

async function loginAsConsultant(page: Page): Promise<void> {
  const username = process.env.E2E_CONSULTANT_USERNAME;
  const password = process.env.E2E_CONSULTANT_PASSWORD;
  test.skip(!username || !password, "Stel E2E_CONSULTANT_USERNAME en E2E_CONSULTANT_PASSWORD in om deze test uit te voeren.");
  if (!username || !password) throw new Error("Consultant credentials are required.");

  await page.goto("/login");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function getAppointmentData(page: Page): Promise<AppointmentData> {
  const clientSelect = page.locator("#appointment-client");
  await expect(clientSelect).toBeEnabled();
  await expect(clientSelect.locator("option").nth(1)).toBeAttached();
  const clientName = (await clientSelect.locator("option").nth(1).textContent())?.trim();
  if (!clientName) throw new Error("No client is available for the appointment test.");
  const consultantResponse = await page.request.get(new URL("/api/consultant", page.url()).toString());
  expect(consultantResponse.ok()).toBeTruthy();
  const consultant = await consultantResponse.json() as Consultant;
  const werkdagen = String(consultant.werkdagen || "");
  test.skip(!werkdagen, "Voor deze consultant zijn geen werkdagen ingesteld.");
  if (!werkdagen) throw new Error("Consultant workdays are required.");

  const appointmentDate = new Date();
  appointmentDate.setDate(appointmentDate.getDate() + 1);
  const weekdayNames = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];
  while (!werkdagen.includes(weekdayNames[appointmentDate.getDay()])) {
    appointmentDate.setDate(appointmentDate.getDate() + 1);
  }
  const dateValue = [appointmentDate.getFullYear(), String(appointmentDate.getMonth() + 1).padStart(2, "0"), String(appointmentDate.getDate()).padStart(2, "0")].join("-");
  const notes = `Playwright appointment ${Date.now()}`;

  return { clientSelect, clientName, dateValue, notes, werkdagen };
}

function formatDate(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

async function deleteAppointment(page: Page, id: string): Promise<void> {
  const response = await page.request.delete(new URL(`/api/appointments/${id}`, page.url()).toString());
  expect(response.status()).toBe(204);
}

test.beforeEach(async ({ page }) => {
  await loginAsConsultant(page);
});

test("TC-01: consultant kan inloggen en de volledige naam en locatie zien", async ({ page }) => {
  const response = await page.request.get(new URL("/api/consultant", page.url()).toString());
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json();

  expect(consultant.name).toBeTruthy();
  expect(consultant.name).not.toBe("Agenda");
  expect(consultant.username).toBeTruthy();
  expect(consultant.locationName).toBeTruthy();
  await expect(page.locator("#consultant-name")).toHaveText(`${consultant.name} (${consultant.username})`);
  await expect(page.locator("#consultant-location")).toHaveText(`Locatie: ${consultant.locationName}`);
});

test("TC-02: consultant kan instellingen bekijken en werkdagen wijzigen", async ({ page }) => {
  await page.getByRole("button", { name: "Menu openen" }).click();
  await expect(page.getByRole("button", { name: "Uitloggen" })).toBeVisible();
  await expect(page.locator("#settings-button")).toBeVisible();
  await expect(page.locator("#settings-button")).toHaveAttribute("href", "/settings");
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
    const saveResponsePromise = page.waitForResponse((response) =>
      response.url() === new URL("/api/consultant/settings", page.url()).toString()
      && response.request().method() === "PATCH");
    await page.locator("#save-button").click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();
    await expect(page.locator("#settings-status")).toHaveText("Instellingen zijn opgeslagen.");
    const updatedResponse = await page.request.get(new URL("/api/consultant/settings", page.url()).toString());
    const updatedConsultant = await updatedResponse.json();
    expect(updatedConsultant.werkdagen.includes("Ma")).toBe(false);
    await expect(monday).not.toBeChecked();
  } finally {
    if (mondayWasEnabled) await monday.check();
    const restoreResponsePromise = page.waitForResponse((response) =>
      response.url() === new URL("/api/consultant/settings", page.url()).toString()
      && response.request().method() === "PATCH");
    await page.locator("#save-button").click();
    const restoreResponse = await restoreResponsePromise;
    expect(restoreResponse.ok()).toBeTruthy();
    const restoredConsultant = await restoreResponse.json() as { werkdagen: string };
    expect(restoredConsultant.werkdagen.includes("Ma")).toBe(mondayWasEnabled);
    await expect(page.locator("#settings-status")).toHaveText("Instellingen zijn opgeslagen.");
  }
});

test("TC-02b: consultant kan contactgegevens, functie en werktijden wijzigen", async ({ page }) => {
  await page.goto("/settings");
  const settingsUrl = new URL("/api/consultant/settings", page.url()).toString();
  const response = await page.request.get(settingsUrl);
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json() as {
    voornaam: string;
    tussenvoegsel: string | null;
    achternaam: string;
    email: string;
    telefoonnummer: string | null;
    functie: string;
    start_werkdag: string;
    einde_werkdag: string;
    defaultlocatie: number;
    werkdagen: string;
  };
  const original = {
    voornaam: consultant.voornaam,
    tussenvoegsel: consultant.tussenvoegsel || "",
    achternaam: consultant.achternaam,
    email: consultant.email,
    telefoonnummer: consultant.telefoonnummer || "",
    functie: consultant.functie,
    start_werkdag: consultant.start_werkdag.slice(0, 5),
    einde_werkdag: consultant.einde_werkdag.slice(0, 5),
    defaultlocatie: consultant.defaultlocatie,
    werkdagen: ["Ma", "Di", "Wo", "Do", "Vr"]
      .filter((weekday) => consultant.werkdagen?.includes(weekday)),
  };
  const updated = {
    ...original,
    voornaam: `Test${original.voornaam}`,
    email: `settings-${Date.now()}@example.invalid`,
    telefoonnummer: "0612345678",
    functie: original.functie.toLocaleLowerCase("nl-NL") === "beheerder" ? original.functie : "Testfunctie",
    start_werkdag: "09:15",
    einde_werkdag: "17:15",
  };

  async function fillAndSave(values: typeof original) {
    await page.locator("#setting-first-name").fill(values.voornaam);
    await page.locator("#setting-prefix").fill(values.tussenvoegsel);
    await page.locator("#setting-last-name").fill(values.achternaam);
    await page.locator("#setting-email").fill(values.email);
    await page.locator("#setting-phone").fill(values.telefoonnummer);
    await page.locator("#setting-role").fill(values.functie);
    await page.locator("#setting-start-werkdag").fill(values.start_werkdag);
    await page.locator("#setting-einde-werkdag").fill(values.einde_werkdag);
    await page.locator("#setting-default-location").selectOption(String(values.defaultlocatie));
    for (const weekday of ["Ma", "Di", "Wo", "Do", "Vr"]) {
      const checkbox = page.locator(`[data-weekday="${weekday}"]`);
      const shouldBeChecked = values.werkdagen.includes(weekday);
      if (shouldBeChecked) await checkbox.check();
      else await checkbox.uncheck();
    }
    await page.locator("#save-button").click();
    await expect(page.locator("#settings-status")).toHaveText("Instellingen zijn opgeslagen.");
  }

  try {
    await fillAndSave(updated);
    const updatedResponse = await page.request.get(settingsUrl);
    expect(updatedResponse.ok()).toBeTruthy();
    const saved = await updatedResponse.json();
    expect(saved.voornaam).toBe(updated.voornaam);
    expect(saved.email).toBe(updated.email);
    expect(saved.telefoonnummer).toBe(updated.telefoonnummer);
    expect(saved.functie).toBe(updated.functie);
    expect(saved.start_werkdag).toContain(updated.start_werkdag);
    expect(saved.einde_werkdag).toContain(updated.einde_werkdag);
  } finally {
    await fillAndSave(original);
  }

  if (original.functie.toLocaleLowerCase("nl-NL") !== "beheerder") {
    const promotionAttempt = await page.request.patch(settingsUrl, {
      data: { ...original, functie: "Beheerder" },
    });
    expect(promotionAttempt.status()).toBe(403);
  }
});

test("TC-02a: consultant kan een werklocatie kiezen en de bijbehorende adresgegevens bekijken", async ({ page }) => {
  await page.goto("/settings");

  const settingsUrl = new URL("/api/consultant/settings", page.url()).toString();
  const locationsUrl = new URL("/api/consultant/settings/locations", page.url()).toString();
  const settingsResponse = await page.request.get(settingsUrl);
  const locationsResponse = await page.request.get(locationsUrl);
  expect(settingsResponse.ok()).toBeTruthy();
  expect(locationsResponse.ok()).toBeTruthy();
  const consultant = await settingsResponse.json() as { defaultlocatie: number; werkdagen: string | null };
  const locations = await locationsResponse.json() as WorkLocation[];
  const originalLocationId = String(consultant.defaultlocatie);
  const originalLocation = locations.find((location) => String(location.id) === originalLocationId);
  expect(originalLocation).toBeTruthy();

  const locationSelect = page.locator("#setting-default-location");
  await expect(locationSelect).toHaveValue(originalLocationId);
  for (const field of ["#setting-adres", "#setting-postcode", "#setting-plaats"]) {
    await expect(page.locator(field)).toHaveJSProperty("readOnly", true);
  }
  await expect(page.locator("#setting-adres")).toHaveValue(originalLocation?.adres || "");
  await expect(page.locator("#setting-postcode")).toHaveValue(originalLocation?.postcode || "");
  await expect(page.locator("#setting-plaats")).toHaveValue(originalLocation?.plaats || "");

  const alternativeLocation = locations.find((location) => String(location.id) !== originalLocationId);
  test.skip(!alternativeLocation, "Er zijn minstens twee locaties nodig om de locatiekeuze te testen.");
  if (!alternativeLocation) return;

  try {
    await locationSelect.selectOption(String(alternativeLocation.id));
    await expect(page.locator("#setting-adres")).toHaveValue(alternativeLocation.adres || "");
    await expect(page.locator("#setting-postcode")).toHaveValue(alternativeLocation.postcode || "");
    await expect(page.locator("#setting-plaats")).toHaveValue(alternativeLocation.plaats || "");
    await page.locator("#save-button").click();
    await expect(page.locator("#settings-status")).toHaveText("Instellingen zijn opgeslagen.");

    const updatedResponse = await page.request.get(settingsUrl);
    expect(updatedResponse.ok()).toBeTruthy();
    const updatedConsultant = await updatedResponse.json() as { defaultlocatie: number };
    expect(Number(updatedConsultant.defaultlocatie)).toBe(alternativeLocation.id);
  } finally {
    await locationSelect.selectOption(originalLocationId);
    await page.locator("#save-button").click();
    await expect(page.locator("#settings-status")).toHaveText("Instellingen zijn opgeslagen.");
  }
});

test("TC-03: consultant kan een afspraak inplannen op een werkdag", async ({ page }) => {
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
  const appointment = await response.json() as CreatedAppointment;

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

test("TC-04: het formulier toont een foutmelding bij een datum in het verleden", async ({ page }) => {
  await getAppointmentData(page);
  const dateInput = page.locator("#appointment-date");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  while (yesterday.getDay() === 0 || yesterday.getDay() === 6) {
    yesterday.setDate(yesterday.getDate() - 1);
  }

  const formattedDate = formatDate(yesterday).split("-").reverse().join("-");
  await dateInput.fill(formattedDate);
  await dateInput.blur();
  await expect(page.locator("#appointment-date-error")).toHaveText("Een datum in het verleden is niet toegestaan.");

});

test("TC-05: het formulier weigert een ongeldige datum", async ({ page }) => {
  await getAppointmentData(page);
  const dateInput = page.locator("#appointment-date");
  const formattedDate = '48022030'
  await dateInput.fill(formattedDate);
  await dateInput.blur();
  await expect(page.locator("#appointment-date-error")).toHaveText("De ingevoerde datum is ongeldig");


});

test("TC-06: een niet-ingeroosterde dag is niet beschikbaar als afspraakdatum", async ({ page }) => {
  const { clientName, werkdagen } = await getAppointmentData(page);
  const dateInput = page.locator("#appointment-date");
  const datePicker = page.locator("#appointment-date-picker");
  const unavailableDate = new Date();
  unavailableDate.setDate(unavailableDate.getDate() + 1);
  const weekdayNames = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];
  // Zoek de eerstvolgende datum waarop de consultant niet werkt.
  while (werkdagen.includes(weekdayNames[unavailableDate.getDay()])) unavailableDate.setDate(unavailableDate.getDate() + 1);
  const unavailableDateValue = formatDate(unavailableDate);

  // Controleer dat deze datum in de kalender niet gekozen kan worden.
  await datePicker.click();
  for (let monthIndex = 0; monthIndex < 2 && await page.locator(`#appointment-date-calendar [data-date="${unavailableDateValue}"]`).count() === 0; monthIndex += 1) {
    await page.locator("[data-calendar-next]").click();
  }
  await expect(page.locator(`#appointment-date-calendar [data-date="${unavailableDateValue}"]`)).toBeDisabled();

  // Controleer de fout zowel bij het aanmaken via de API als in het formulier.
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

test("TC-07: de API weigert een afspraak met een datum in het verleden", async ({ page }) => {
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

test("TC-08: een ingeplande afspraak wordt zichtbaar in de agenda", async ({ page }) => {
  const { clientName, dateValue, notes } = await getAppointmentData(page);
  const createResponse = await page.request.post(new URL("/api/appointments", page.url()).toString(), {
    data: { date: dateValue, client: clientName, start: "10:15", durationMinutes: 30, notes },
  });
  expect(createResponse.status()).toBe(201);
  const appointment = await createResponse.json() as CreatedAppointment;

  try {
    await page.reload();
    const clientFilter = page.locator("#agenda-client-filter option");
    const normalizedClientName = clientName.trim().toLocaleLowerCase("nl-NL");
    await expect.poll(() => clientFilter.evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value.trim().toLocaleLowerCase("nl-NL")).filter(Boolean),
    )).toContain(normalizedClientName);
    const clientFilterValues = await clientFilter.evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value.trim().toLocaleLowerCase("nl-NL")).filter(Boolean),
    );
    expect(new Set(clientFilterValues).size).toBe(clientFilterValues.length);
    expect(clientFilterValues).toContain(normalizedClientName);
    const today = new Date();
    const appointmentDate = new Date(`${dateValue}T00:00:00`);
    const monday = (date: Date): Date => {
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
