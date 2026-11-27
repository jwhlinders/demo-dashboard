import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { createBdd, test } from "playwright-bdd";

const { Given, When, Then, After } = createBdd();

type ConsultantSettings = {
  username: string;
  password: string;
  werkdagen: string;
  voornaam: string;
  tussenvoegsel: string | null;
  achternaam: string;
  email: string;
  telefoonnummer: string | null;
  functie: string;
  start_werkdag: string;
  einde_werkdag: string;
  defaultlocatie: number;
};

type WorkLocation = {
  id: number;
  naam: string;
  adres: string | null;
  postcode: string | null;
  plaats: string | null;
};

type Appointment = {
  id: string;
  client: string;
  clientUsername: string;
  date: string;
  start: string;
  notes: string;
};

type AppointmentData = {
  clientSelect: Locator;
  clientName: string;
  dateValue: string;
  notes: string;
  werkdagen: string;
};

type SettingsValues = {
  voornaam: string;
  tussenvoegsel: string;
  achternaam: string;
  email: string;
  telefoonnummer: string;
  functie: string;
  start_werkdag: string;
  einde_werkdag: string;
  defaultlocatie: number;
  werkdagen: string[];
};

type ConsultantScenario = {
  mondayWasEnabled?: boolean;
  originalSettings?: SettingsValues;
  originalLocation?: WorkLocation;
  selectedLocation?: WorkLocation;
  appointmentData?: AppointmentData;
  appointment?: Appointment;
  createdAppointmentId?: string;
  apiResponse?: { status: number; body: unknown };
};

const scenarios = new WeakMap<Page, ConsultantScenario>();
const weekdayNames = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];

function getScenario(page: Page): ConsultantScenario {
  const scenario = scenarios.get(page);
  if (!scenario) throw new Error("De consultantcontext is niet geïnitialiseerd.");
  return scenario;
}

function urlFor(page: Page, path: string): string {
  return new URL(path, page.url()).toString();
}

function formatDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getNextWeekday(workdays: string): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  for (let days = 0; days < 14; days += 1) {
    if (workdays.includes(weekdayNames[date.getDay()])) return date;
    date.setDate(date.getDate() + 1);
  }
  throw new Error("Er is binnen twee weken geen werkdag voor deze consultant gevonden.");
}

async function getAppointmentData(page: Page): Promise<AppointmentData> {
  const clientSelect = page.locator("#appointment-client");
  await expect(clientSelect).toBeEnabled();
  await expect(clientSelect.locator("option").nth(1)).toBeAttached();
  const clientName = (await clientSelect.locator("option").nth(1).textContent())?.trim();
  if (!clientName) throw new Error("Er is geen cliënt beschikbaar voor de afspraaktest.");

  const response = await page.request.get(urlFor(page, "/api/consultant"));
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json() as { werkdagen: string | null };
  const werkdagen = String(consultant.werkdagen || "");
  test.skip(!werkdagen, "Voor deze consultant zijn geen werkdagen ingesteld.");
  if (!werkdagen) throw new Error("Werkdagen zijn vereist voor deze afspraaktest.");

  const appointmentData = {
    clientSelect,
    clientName,
    dateValue: formatDate(getNextWeekday(werkdagen)),
    notes: `Playwright appointment ${Date.now()}`,
    werkdagen,
  };
  getScenario(page).appointmentData = appointmentData;
  return appointmentData;
}

async function saveSettings(page: Page, values: SettingsValues): Promise<void> {
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
    if (values.werkdagen.includes(weekday)) await checkbox.check();
    else await checkbox.uncheck();
  }

  await page.locator("#save-button").click();
  await expect(page.locator("#settings-status")).toHaveText("Instellingen zijn opgeslagen.");
}

async function deleteAppointment(page: Page, id: string): Promise<void> {
  const response = await page.request.delete(urlFor(page, `/api/appointments/${id}`));
  expect(response.status()).toBe(204);
}

async function restoreLocation(page: Page, originalLocation: WorkLocation): Promise<void> {
  const response = await page.request.get(urlFor(page, "/api/consultant/settings"));
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json() as Pick<ConsultantSettings, "defaultlocatie">;
  if (consultant.defaultlocatie === originalLocation.id) return;

  await page.goto("/settings");
  await page.locator("#setting-default-location").selectOption(String(originalLocation.id));
  await page.locator("#save-button").click();
  await expect(page.locator("#settings-status")).toHaveText("Instellingen zijn opgeslagen.");
}

Given("ik ben ingelogd als consultant", async ({ page }) => {
  const username = process.env.E2E_CONSULTANT_USERNAME;
  const password = process.env.E2E_CONSULTANT_PASSWORD;
  scenarios.set(page, {});
  test.skip(
    !username || !password,
    "Stel E2E_CONSULTANT_USERNAME en E2E_CONSULTANT_PASSWORD in om deze test uit te voeren.",
  );
  if (!username || !password) throw new Error("Consultantgegevens zijn vereist.");

  await page.goto("/login");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

After(async ({ page }) => {
  const scenario = scenarios.get(page);
  if (scenario?.originalLocation) {
    await restoreLocation(page, scenario.originalLocation);
  }
  const id = scenario?.createdAppointmentId;
  if (id) await deleteAppointment(page, id);
});

Then("zie ik mijn volledige naam, gebruikersnaam en locatie", async ({ page }) => {
  const response = await page.request.get(urlFor(page, "/api/consultant"));
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json() as {
    name: string;
    username: string;
    locationName: string;
  };

  expect(consultant.name).toBeTruthy();
  expect(consultant.name).not.toBe("Agenda");
  expect(consultant.username).toBeTruthy();
  expect(consultant.locationName).toBeTruthy();
  await expect(page.locator("#consultant-name")).toHaveText(
    `${consultant.name} (${consultant.username})`,
  );
  await expect(page.locator("#consultant-location")).toHaveText(
    `Locatie: ${consultant.locationName}`,
  );
});

When("ik de instellingen open en de werkdagen controleer", async ({ page }) => {
  await page.getByRole("button", { name: "Menu openen" }).click();
  await expect(page.getByRole("button", { name: "Uitloggen" })).toBeVisible();
  await expect(page.locator("#settings-button")).toBeVisible();
  await expect(page.locator("#settings-button")).toHaveAttribute("href", "/settings");
  await page.locator("#settings-button").click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator("#settings-title")).toHaveText("Instellingen");
  const response = await page.request.get(urlFor(page, "/api/consultant/settings"));
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json() as Pick<ConsultantSettings, "username" | "password" | "werkdagen">;
  expect(consultant.username).toBeTruthy();
  expect(consultant.password).toBe("********");
  await expect(page.locator("#consultant-name")).toContainText(`(${consultant.username})`);

  for (const weekday of ["Ma", "Di", "Wo", "Do", "Vr"]) {
    const isWorkday = consultant.werkdagen
      .toLocaleLowerCase("nl-NL")
      .includes(weekday.toLocaleLowerCase("nl-NL"));
    await expect(page.locator(`[data-weekday="${weekday}"]`)).toBeChecked({
      checked: isWorkday,
    });
  }

  getScenario(page).mondayWasEnabled = consultant.werkdagen.includes("Ma");
});

When("ik maandag uitschakel en de instellingen opsla", async ({ page }) => {
  const scenario = getScenario(page);
  if (scenario.mondayWasEnabled === undefined) {
    throw new Error("De oorspronkelijke instelling van maandag is niet opgeslagen.");
  }
  const monday = page.locator('[data-weekday="Ma"]');

  try {
    await monday.uncheck();
    const saveResponsePromise = page.waitForResponse((response) =>
      response.url() === urlFor(page, "/api/consultant/settings")
      && response.request().method() === "PATCH");
    await page.locator("#save-button").click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();
    await expect(page.locator("#settings-status")).toHaveText("Instellingen zijn opgeslagen.");
    const response = await page.request.get(urlFor(page, "/api/consultant/settings"));
    const updatedConsultant = await response.json() as Pick<ConsultantSettings, "werkdagen">;
    expect(updatedConsultant.werkdagen.includes("Ma")).toBe(false);
    await expect(monday).not.toBeChecked();
  } finally {
    if (scenario.mondayWasEnabled) await monday.check();
    const restoreResponsePromise = page.waitForResponse((response) =>
      response.url() === urlFor(page, "/api/consultant/settings")
      && response.request().method() === "PATCH");
    await page.locator("#save-button").click();
    const restoreResponse = await restoreResponsePromise;
    expect(restoreResponse.ok()).toBeTruthy();
    const restoredConsultant = await restoreResponse.json() as Pick<ConsultantSettings, "werkdagen">;
    expect(restoredConsultant.werkdagen.includes("Ma")).toBe(scenario.mondayWasEnabled);
    await expect(page.locator("#settings-status")).toHaveText("Instellingen zijn opgeslagen.");
  }
});

Then("is de wijziging opgeslagen en is maandag hersteld", async ({ page }) => {
  const scenario = getScenario(page);
  const response = await page.request.get(urlFor(page, "/api/consultant/settings"));
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json() as Pick<ConsultantSettings, "werkdagen">;
  expect(consultant.werkdagen.includes("Ma")).toBe(scenario.mondayWasEnabled);
  await expect(page.locator('[data-weekday="Ma"]')).toBeChecked({
    checked: scenario.mondayWasEnabled,
  });
});

When("ik mijn contactgegevens, functie en werktijden wijzig", async ({ page }) => {
  await page.goto("/settings");
  const settingsUrl = urlFor(page, "/api/consultant/settings");
  const response = await page.request.get(settingsUrl);
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json() as ConsultantSettings;
  const original: SettingsValues = {
    voornaam: consultant.voornaam,
    tussenvoegsel: consultant.tussenvoegsel || "",
    achternaam: consultant.achternaam,
    email: consultant.email,
    telefoonnummer: consultant.telefoonnummer || "",
    functie: consultant.functie,
    start_werkdag: consultant.start_werkdag.slice(0, 5),
    einde_werkdag: consultant.einde_werkdag.slice(0, 5),
    defaultlocatie: consultant.defaultlocatie,
    werkdagen: ["Ma", "Di", "Wo", "Do", "Vr"].filter((weekday) =>
      consultant.werkdagen?.includes(weekday),
    ),
  };
  getScenario(page).originalSettings = original;

  const updated: SettingsValues = {
    ...original,
    voornaam: `Test${original.voornaam}`,
    email: `settings-${Date.now()}@example.invalid`,
    telefoonnummer: "0612345678",
    functie:
      original.functie.toLocaleLowerCase("nl-NL") === "beheerder"
        ? original.functie
        : "Testfunctie",
    start_werkdag: "09:15",
    einde_werkdag: "17:15",
  };

  try {
    await saveSettings(page, updated);
    const updatedResponse = await page.request.get(settingsUrl);
    expect(updatedResponse.ok()).toBeTruthy();
    const saved = await updatedResponse.json() as ConsultantSettings;
    expect(saved.voornaam).toBe(updated.voornaam);
    expect(saved.email).toBe(updated.email);
    expect(saved.telefoonnummer).toBe(updated.telefoonnummer);
    expect(saved.functie).toBe(updated.functie);
    expect(saved.start_werkdag).toContain(updated.start_werkdag);
    expect(saved.einde_werkdag).toContain(updated.einde_werkdag);
  } finally {
    await saveSettings(page, original);
  }
});

Then("worden de gegevens opgeslagen en daarna hersteld", async ({ page }) => {
  const original = getScenario(page).originalSettings;
  if (!original) throw new Error("De oorspronkelijke consultantinstellingen ontbreken.");

  const response = await page.request.get(urlFor(page, "/api/consultant/settings"));
  expect(response.ok()).toBeTruthy();
  const restored = await response.json() as ConsultantSettings;
  expect(restored.voornaam).toBe(original.voornaam);
  expect(restored.email).toBe(original.email);
  expect(restored.telefoonnummer || "").toBe(original.telefoonnummer);
  expect(restored.functie).toBe(original.functie);
  expect(restored.start_werkdag).toContain(original.start_werkdag);
  expect(restored.einde_werkdag).toContain(original.einde_werkdag);
});

Then("kan ik mezelf niet promoveren tot beheerder", async ({ page }) => {
  const original = getScenario(page).originalSettings;
  if (!original) throw new Error("De oorspronkelijke consultantinstellingen ontbreken.");

  if (original.functie.toLocaleLowerCase("nl-NL") !== "beheerder") {
    const response = await page.request.patch(urlFor(page, "/api/consultant/settings"), {
      data: { ...original, functie: "Beheerder" },
    });
    expect(response.status()).toBe(403);
  }
});

When("ik een andere werklocatie selecteer", async ({ page }) => {
  await page.goto("/settings");
  const settingsResponse = await page.request.get(urlFor(page, "/api/consultant/settings"));
  const locationsResponse = await page.request.get(
    urlFor(page, "/api/consultant/settings/locations"),
  );
  expect(settingsResponse.ok()).toBeTruthy();
  expect(locationsResponse.ok()).toBeTruthy();
  const consultant = await settingsResponse.json() as Pick<ConsultantSettings, "defaultlocatie">;
  const locations = await locationsResponse.json() as WorkLocation[];
  const originalLocation = locations.find(
    (location) => location.id === consultant.defaultlocatie,
  );
  expect(originalLocation).toBeTruthy();
  const locationSelect = page.locator("#setting-default-location");
  await expect(locationSelect).toHaveValue(String(consultant.defaultlocatie));
  for (const field of ["#setting-adres", "#setting-postcode", "#setting-plaats"]) {
    await expect(page.locator(field)).toHaveJSProperty("readOnly", true);
  }
  await expect(page.locator("#setting-adres")).toHaveValue(originalLocation?.adres || "");
  await expect(page.locator("#setting-postcode")).toHaveValue(originalLocation?.postcode || "");
  await expect(page.locator("#setting-plaats")).toHaveValue(originalLocation?.plaats || "");

  const alternativeLocation = locations.find(
    (location) => location.id !== consultant.defaultlocatie,
  );
  test.skip(!alternativeLocation, "Er zijn minstens twee locaties nodig om de locatiekeuze te testen.");
  if (!alternativeLocation || !originalLocation) return;

  const scenario = getScenario(page);
  scenario.originalLocation = originalLocation;
  scenario.selectedLocation = alternativeLocation;

  await locationSelect.selectOption(String(alternativeLocation.id));
  await expect(page.locator("#setting-adres")).toHaveValue(alternativeLocation.adres || "");
  await expect(page.locator("#setting-postcode")).toHaveValue(
    alternativeLocation.postcode || "",
  );
  await expect(page.locator("#setting-plaats")).toHaveValue(alternativeLocation.plaats || "");
  await page.locator("#save-button").click();
  await expect(page.locator("#settings-status")).toHaveText("Instellingen zijn opgeslagen.");
});

Then("worden de bijbehorende adresgegevens getoond en opgeslagen", async ({ page }) => {
  const { selectedLocation } = getScenario(page);
  if (!selectedLocation) throw new Error("De alternatieve werklocatie ontbreekt.");
  await expect(page.locator("#setting-adres")).toHaveValue(selectedLocation.adres || "");
  await expect(page.locator("#setting-postcode")).toHaveValue(selectedLocation.postcode || "");
  await expect(page.locator("#setting-plaats")).toHaveValue(selectedLocation.plaats || "");
  const response = await page.request.get(urlFor(page, "/api/consultant/settings"));
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json() as Pick<ConsultantSettings, "defaultlocatie">;
  expect(consultant.defaultlocatie).toBe(selectedLocation.id);
});

Then("is de oorspronkelijke werklocatie hersteld", async ({ page }) => {
  const { originalLocation } = getScenario(page);
  if (!originalLocation) throw new Error("De oorspronkelijke werklocatie ontbreekt.");
  await restoreLocation(page, originalLocation);
  const response = await page.request.get(urlFor(page, "/api/consultant/settings"));
  expect(response.ok()).toBeTruthy();
  const consultant = await response.json() as Pick<ConsultantSettings, "defaultlocatie">;
  expect(consultant.defaultlocatie).toBe(originalLocation.id);
});

When("ik een afspraak op een werkdag inplan", async ({ page }) => {
  const { clientSelect, clientName, dateValue, notes } = await getAppointmentData(page);
  const datePicker = page.locator("#appointment-date-picker");
  await datePicker.click();
  for (
    let month = 0;
    month < 2 && await page.locator(
      `#appointment-date-calendar [data-date="${dateValue}"]`,
    ).count() === 0;
    month += 1
  ) {
    await page.locator("[data-calendar-next]").click();
  }

  const workdayButton = page.locator(
    `#appointment-date-calendar [data-date="${dateValue}"]`,
  );
  await expect(workdayButton).toBeEnabled();
  await workdayButton.click();
  const [year, month, day] = dateValue.split("-");
  await expect(page.locator("#appointment-date")).toHaveValue(`${day}-${month}-${year}`);
  await clientSelect.selectOption({ index: 1 });
  await page.locator("#appointment-hour").selectOption("10");
  await page.locator("#appointment-minute").selectOption("15");
  await page.locator("#appointment-duration").fill("30");
  await page.locator("#appointment-notes").fill(notes);

  const createResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/appointments") &&
    response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Afspraak opslaan" }).click();
  const response = await createResponse;
  expect(response.status()).toBe(201);
  const appointment = await response.json() as Appointment;
  const scenario = getScenario(page);
  scenario.appointment = appointment;
  scenario.createdAppointmentId = appointment.id;
  scenario.appointmentData = { clientSelect, clientName, dateValue, notes, werkdagen: "" };
});

Then("is de afspraak met de juiste gegevens aangemaakt", async ({ page }) => {
  const { appointment, appointmentData } = getScenario(page);
  if (!appointment || !appointmentData) throw new Error("De aangemaakte afspraak ontbreekt.");
  expect(appointment.client).toBe(appointmentData.clientName);
  expect(appointment.clientUsername).toBeTruthy();
  expect(appointment.date).toBe(appointmentData.dateValue);
  expect(appointment.start).toBe("10:15");
  expect(appointment.notes).toBe(appointmentData.notes);
});

When("ik een datum in het verleden invul", async ({ page }) => {
  await getAppointmentData(page);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  while (yesterday.getDay() === 0 || yesterday.getDay() === 6) {
    yesterday.setDate(yesterday.getDate() - 1);
  }
  const formattedDate = formatDate(yesterday).split("-").reverse().join("-");
  await page.locator("#appointment-date").fill(formattedDate);
  await page.locator("#appointment-date").blur();
});

Then("wordt gemeld dat een datum in het verleden niet is toegestaan", async ({ page }) => {
  await expect(page.locator("#appointment-date-error")).toHaveText(
    "Een datum in het verleden is niet toegestaan.",
  );
});

When("ik een ongeldige datum invul", async ({ page }) => {
  await getAppointmentData(page);
  const dateInput = page.locator("#appointment-date");
  await dateInput.fill("48022030");
  await dateInput.blur();
});

Then("wordt gemeld dat de ingevoerde datum ongeldig is", async ({ page }) => {
  await expect(page.locator("#appointment-date-error")).toHaveText(
    "De ingevoerde datum is ongeldig",
  );
});

When("ik een niet-ingeroosterde dag als afspraakdatum probeer te gebruiken", async ({ page }) => {
  const { clientName, werkdagen } = await getAppointmentData(page);
  const unavailableDate = new Date();
  unavailableDate.setDate(unavailableDate.getDate() + 1);
  let foundUnavailableDay = false;
  for (let days = 0; days < 14; days += 1) {
    if (!werkdagen.includes(weekdayNames[unavailableDate.getDay()])) {
      foundUnavailableDay = true;
      break;
    }
    unavailableDate.setDate(unavailableDate.getDate() + 1);
  }
  if (!foundUnavailableDay) {
    throw new Error("Er is binnen twee weken geen niet-ingeroosterde dag gevonden.");
  }
  const unavailableDateValue = formatDate(unavailableDate);
  const [year, month, day] = unavailableDateValue.split("-");

  await page.locator("#appointment-date-picker").click();
  for (
    let monthIndex = 0;
    monthIndex < 2 && await page.locator(
      `#appointment-date-calendar [data-date="${unavailableDateValue}"]`,
    ).count() === 0;
    monthIndex += 1
  ) {
    await page.locator("[data-calendar-next]").click();
  }
  await expect(
    page.locator(`#appointment-date-calendar [data-date="${unavailableDateValue}"]`),
  ).toBeDisabled();

  const response = await page.request.post(urlFor(page, "/api/appointments"), {
    data: {
      date: unavailableDateValue,
      client: clientName,
      start: "10:15",
      durationMinutes: 30,
      notes: "",
    },
  });
  const responseBody = await response.json() as { error: string };
  expect(response.status()).toBe(400);
  expect(responseBody).toEqual({
    error: `consultant niet aanwezig op ${day}-${month}-${year}`,
  });

  await page.locator("#appointment-date").fill(`${day}${month}${year}`);
  await page.locator("#appointment-date").blur();
  await expect(page.locator("#appointment-date-error")).toHaveText(responseBody.error);
});

Then("is die dag niet beschikbaar en wordt de afspraak geweigerd", async ({ page }) => {
  await expect(page.locator("#appointment-date-error")).toContainText(
    "consultant niet aanwezig op",
  );
});

When("ik via de API een afspraak in het verleden probeer te maken", async ({ page }) => {
  const { clientName } = await getAppointmentData(page);
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 1);
  while (pastDate.getDay() === 0 || pastDate.getDay() === 6) {
    pastDate.setDate(pastDate.getDate() - 1);
  }
  const response = await page.request.post(urlFor(page, "/api/appointments"), {
    data: {
      date: formatDate(pastDate),
      client: clientName,
      start: "10:15",
      durationMinutes: 30,
      notes: "",
    },
  });
  getScenario(page).apiResponse = {
    status: response.status(),
    body: await response.json(),
  };
});

Then("wordt de afspraak geweigerd met een foutmelding", async ({ page }) => {
  const response = getScenario(page).apiResponse;
  if (!response) throw new Error("Het API-resultaat ontbreekt.");
  expect(response.status).toBe(400);
  expect(response.body).toEqual({
    error: "Afspraken in het verleden zijn niet toegestaan.",
  });
});

When("ik een afspraak aanmaak via de API", async ({ page }) => {
  const { clientName, dateValue, notes } = await getAppointmentData(page);
  const response = await page.request.post(urlFor(page, "/api/appointments"), {
    data: {
      date: dateValue,
      client: clientName,
      start: "10:15",
      durationMinutes: 30,
      notes,
    },
  });
  expect(response.status()).toBe(201);
  const appointment = await response.json() as Appointment;
  const scenario = getScenario(page);
  scenario.appointment = appointment;
  scenario.createdAppointmentId = appointment.id;
  scenario.appointmentData = {
    clientSelect: page.locator("#appointment-client"),
    clientName,
    dateValue,
    notes,
    werkdagen: "",
  };
});

Then("wordt de afspraak zichtbaar in de agenda", async ({ page }) => {
  const { appointment, appointmentData } = getScenario(page);
  if (!appointment || !appointmentData) throw new Error("De aangemaakte afspraak ontbreekt.");
  await page.reload();

  const clientFilter = page.locator("#agenda-client-filter option");
  const normalizedClientName = appointmentData.clientName.trim().toLocaleLowerCase("nl-NL");
  const clientFilterValues = async () => clientFilter.evaluateAll((options) =>
    options
      .map((option) => (option as HTMLOptionElement).value.trim().toLocaleLowerCase("nl-NL"))
      .filter(Boolean),
  );
  await expect.poll(clientFilterValues).toContain(normalizedClientName);
  const values = await clientFilterValues();
  expect(new Set(values).size).toBe(values.length);

  const today = new Date();
  const appointmentDate = new Date(`${appointmentData.dateValue}T00:00:00`);
  const monday = (date: Date): Date => {
    const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    return weekStart;
  };
  if (monday(appointmentDate) > monday(today)) {
    await page.locator("#next-week").click();
  }

  const appointmentCard = page.locator(".appointment-card").filter({
    hasText: appointmentData.notes,
  });
  await expect(appointmentCard).toHaveCount(1);
  await expect(appointmentCard).toContainText(appointmentData.clientName);
  await expect(appointmentCard).toContainText("10:15 - 10:45");
  await expect(appointmentCard).toContainText(appointmentData.notes);
});
