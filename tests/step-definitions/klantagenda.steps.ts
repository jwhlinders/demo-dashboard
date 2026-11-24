import { expect, test, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { AppointmentPage } from "../pages/appointment-page";
import { LoginPage } from "../pages/login-page";
import {
  addDays,
  formatDateInput,
  isWeekend,
  mondayOf,
  nextSaturday,
  nextScheduledWorkday,
  nextWorkday,
  sameWeek,
  timeRange,
  type Slot,
} from "../helpers/date-time";

const { Given, When, Then, After } = createBdd();

const clientUsername = process.env.E2E_CLIENT_USERNAME ?? "testuser";
const clientPassword = process.env.E2E_CLIENT_PASSWORD ?? "Test1234!";
const cleanupUsername = process.env.E2E_CONSULTANT_USERNAME;
const cleanupPassword = process.env.E2E_CONSULTANT_PASSWORD;

type ScenarioContext = {
  app: AppointmentPage;
  consultantName: string;
  range: string;
  date: Date;
  reason: string;
  createdId?: string;
  pendingResponses: Promise<void>[];
  createRequests?: number;
};

const scenarios = new WeakMap<Page, ScenarioContext>();

function getContext(page: Page): ScenarioContext {
  const context = scenarios.get(page);
  if (!context) throw new Error("De klantagendacontext is niet geinitialiseerd.");
  return context;
}

function uniqueReason(prefix = "Intake"): string {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

async function defaultConsultantWorkdays(page: Page): Promise<string> {
  const response = await page.request.get("/api/appointment-options");
  expect(response.ok()).toBe(true);
  const options = await response.json() as {
    locations: Array<{ id: string | number }>;
    consultants: Array<{ locationId: string | number; werkdagen: string | null }>;
  };
  const defaultLocation = options.locations[0];
  const consultant = options.consultants.find(
    (item) => String(item.locationId) === String(defaultLocation?.id),
  );
  if (!consultant) throw new Error("Geen consultant beschikbaar op de standaardlocatie.");
  const workdays = String(consultant.werkdagen || "");
  test.skip(!workdays, "De standaardconsultant heeft geen werkdagen ingesteld.");
  return workdays;
}

async function createAppointment(
  page: Page,
  date: Date,
  reason: string,
  options: Parameters<AppointmentPage["create"]>[0] = { date, reason },
): Promise<void> {
  const app = getContext(page).app;
  await app.goToWeekOf(date);
  const result = await app.create(options);
  const context = getContext(page);
  context.consultantName = result.consultantName;
  context.range = result.range;
  context.date = date;
  context.reason = reason;
}

Given("ik ben ingelogd als klant", async ({ page }) => {
  scenarios.set(page, {
    app: new AppointmentPage(page),
    consultantName: "",
    range: "",
    date: new Date(),
    reason: "",
    pendingResponses: [],
  });

  const login = new LoginPage(page);
  await login.goto();
  await login.login(clientUsername, clientPassword);
  await login.expectLoggedIn();
  await getContext(page).app.open();

  page.on("response", (response) => {
    const request = response.request();
    if (
      request.method() === "POST" &&
      new URL(response.url()).pathname === "/api/appointments" &&
      response.status() === 201
    ) {
      getContext(page).pendingResponses.push(
        response.json().then((appointment: { id: string; clientUsername: string }) => {
          if (appointment.clientUsername === clientUsername) {
            getContext(page).createdId = appointment.id;
          }
        }),
      );
    }
  });
});

After(async ({ page }) => {
  await Promise.all(scenarios.get(page)?.pendingResponses ?? []);
  const id = scenarios.get(page)?.createdId;
  if (!id) return;
  if (!cleanupUsername || !cleanupPassword) {
    throw new Error(
      "Afspraken opruimen vereist E2E_CONSULTANT_USERNAME en E2E_CONSULTANT_PASSWORD.",
    );
  }

  const browser = page.context().browser();
  if (!browser) return;
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const cleanupPage = await context.newPage();
    const login = new LoginPage(cleanupPage);
    await login.goto();
    await login.login(cleanupUsername, cleanupPassword);
    await login.expectLoggedIn();
    const response = await cleanupPage.request.delete(
      `/api/appointments/${encodeURIComponent(id)}`,
    );
    expect(response.status()).toBe(204);
  } finally {
    await context.close();
  }
});

When("ik een geldige afspraak aanvraag voor de eerstvolgende werkdag", async ({ page }) => {
  const date = nextScheduledWorkday(new Date(), await defaultConsultantWorkdays(page));
  await createAppointment(page, date, uniqueReason());
});

Then("verschijnt de afspraak in de agenda", async ({ page }) => {
  const { app, date, reason, range, consultantName } = getContext(page);
  await app.goToWeekOf(date);
  await app.expectCard(date, reason, { range, consultantName });
});

When("ik via de kalender een afspraak voor volgende week kies", async ({ page }) => {
  const workdays = await defaultConsultantWorkdays(page);
  const nextMonday = addDays(mondayOf(new Date()), 7);
  const date = nextScheduledWorkday(addDays(nextMonday, -1), workdays);
  test.skip(
    !sameWeek(date, nextMonday) || isWeekend(date),
    "De standaardconsultant heeft volgende week geen beschikbare werkdag.",
  );
  const reason = uniqueReason();
  await getContext(page).app.goToWeekOf(date);
  await createAppointment(page, date, reason, {
    date,
    viaCalendar: true,
    reason,
  });
});

Then("verschijnt de afspraak in de agenda van die week", async ({ page }) => {
  const { app, date, reason, range, consultantName } = getContext(page);
  await app.goToWeekOf(date);
  await app.expectCard(date, reason, { range, consultantName });
});

When("ik terugga naar de huidige week", async ({ page }) => {
  await getContext(page).app.currentWeek.click();
});

Then("is de afspraak niet zichtbaar", async ({ page }) => {
  const { app, date, reason } = getContext(page);
  await expect(app.cardIn(date, reason)).toHaveCount(0);
});

When("ik vandaag op een later tijdstip een afspraak aanvraag", async ({ page }) => {
  const now = new Date();
  test.skip(isWeekend(now), "Vandaag is een weekenddag: geen afspraken mogelijk.");
  const hour = now.getHours() + 1;
  test.skip(hour < 8 || hour > 17, "Huidige tijd valt buiten de werktijd.");

  const optionsResponse = await page.request.get("/api/appointment-options");
  expect(optionsResponse.ok()).toBe(true);
  const options = await optionsResponse.json() as {
    consultants: Array<{
      username: string;
      name: string;
      locationId: string | number;
      werkdagen: string | null;
    }>;
  };
  const weekday = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"][now.getDay()];
  const consultant = options.consultants.find((option) =>
    String(option.werkdagen || "")
      .toLocaleLowerCase("nl-NL")
      .includes(weekday.toLocaleLowerCase("nl-NL")),
  );
  test.skip(!consultant, `Er is vandaag geen consultant beschikbaar op ${weekday}.`);
  if (!consultant) throw new Error(`Er is vandaag geen consultant beschikbaar op ${weekday}.`);

  const app = getContext(page).app;
  await app.location.selectOption(String(consultant.locationId));
  await app.consultant.selectOption(consultant.username);
  const reason = uniqueReason();
  const result = await app.create({
    date: now,
    slot: { hour, minute: "00" },
    reason,
    location: null,
    consultant: null,
  });
  Object.assign(getContext(page), {
    consultantName: consultant.name,
    range: result.range,
    date: now,
    reason,
  });
});

Then("verschijnt de afspraak in de agenda van vandaag", async ({ page }) => {
  const { app, date, reason, range, consultantName } = getContext(page);
  await app.goToWeekOf(date);
  await app.expectCard(date, reason, { range, consultantName });
});

When("ik een afspraak met minuut 45 en duur 30 minuten aanvraag", async ({ page }) => {
  const date = nextScheduledWorkday(new Date(), await defaultConsultantWorkdays(page));
  const reason = uniqueReason();
  const slot: Slot = { hour: 10 + Math.floor(Math.random() * 6), minute: "45" };
  const app = getContext(page).app;
  await app.goToWeekOf(date);
  const result = await app.create({ date, slot, reason });
  Object.assign(getContext(page), {
    consultantName: result.consultantName,
    range: result.range,
    date,
    reason,
    slot,
  });
});

Then("wordt een eindtijd binnen het volgende uur getoond", async ({ page }) => {
  const context = getContext(page) as ScenarioContext & { slot: Slot };
  expect(context.range).toBe(timeRange(context.slot, 30));
});

When("ik een afspraak verstuur zonder locatie en consultant", async ({ page }) => {
  const date = nextWorkday(new Date());
  const reason = uniqueReason();
  await createAppointment(page, date, reason, {
    date,
    reason,
    location: null,
    consultant: null,
    expectCreated: false,
  });
});

Then("worden beide velden als verplicht gemeld", async ({ page }) => {
  const app = getContext(page).app;
  expect(await app.location.evaluate((el: HTMLSelectElement) => el.validity.valueMissing)).toBe(true);
  expect(await app.consultant.evaluate((el: HTMLSelectElement) => el.validity.valueMissing)).toBe(true);
});

Then("wordt geen afspraak aangemaakt", async ({ page }) => {
  await getContext(page).app.expectNotCreated(
    getContext(page).date,
    getContext(page).reason,
  );
});

When("ik een afspraak in het weekend probeer aan te vragen", async ({ page }) => {
  const date = nextSaturday(new Date());
  const reason = uniqueReason();
  const app = getContext(page).app;
  await app.create({ date, reason, expectCreated: false });
  Object.assign(getContext(page), { date, reason });
});

Then("wordt de datum geweigerd", async ({ page }) => {
  await expect(getContext(page).app.dateError).toHaveText(/\S/);
});

When("ik een datum kies waarop de consultant niet werkt", async ({ page }) => {
  const pageValue = page;
  const response = await pageValue.request.get("/api/appointment-options");
  expect(response.ok()).toBe(true);
  const options = await response.json() as {
    consultants: Array<{ username: string; locationId: string | number; werkdagen: string | null }>;
  };
  const weekdayNames = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];
  const consultant = options.consultants.find((item) =>
    weekdayNames.slice(1, 6).some((weekday) =>
      !String(item.werkdagen || "").toLocaleLowerCase("nl-NL").includes(
        weekday.toLocaleLowerCase("nl-NL"),
      ),
    ),
  );
  test.skip(!consultant, "Geen consultant met een niet-ingeroosterde werkdag beschikbaar.");
  if (!consultant) return;

  const workdays = String(consultant.werkdagen || "").toLocaleLowerCase("nl-NL");
  const date = addDays(new Date(), 1);
  while (workdays.includes(weekdayNames[date.getDay()].toLocaleLowerCase("nl-NL"))) {
    date.setDate(date.getDate() + 1);
  }
  const app = getContext(pageValue).app;
  await app.location.selectOption(String(consultant.locationId));
  await app.consultant.selectOption(consultant.username);
  await app.setDate(date);
  await app.hour.selectOption("10");
  await app.minute.selectOption("00");
  await app.reason.fill(uniqueReason("Niet-beschikbare consultant"));
  let createRequests = 0;
  const countCreateRequests = (request: { method(): string; url(): string }) => {
    if (request.method() === "POST" && request.url().endsWith("/api/appointments")) {
      createRequests += 1;
    }
  };
  pageValue.on("request", countCreateRequests);
  await app.submit.click();
  pageValue.off("request", countCreateRequests);
  Object.assign(getContext(pageValue), { date, createRequests });
});

Then("wordt gemeld dat de consultant die dag niet aanwezig is", async ({ page }) => {
  await expect(getContext(page).app.dateError).toContainText("consultant niet aanwezig op");
});

Then("wordt geen aanvraag naar de API verstuurd", async ({ page }) => {
  expect(getContext(page).createRequests).toBe(0);
});

When("ik een datum in het verleden probeer aan te vragen", async ({ page }) => {
  const app = getContext(page).app;
  await app.create({
    date: addDays(new Date(), -1),
    reason: uniqueReason(),
    expectCreated: false,
  });
  Object.assign(getContext(page), { date: addDays(new Date(), -1), reason: "" });
});

Then("wordt via het aanvraagformulier gemeld dat een datum in het verleden niet is toegestaan", async ({ page }) => {
  await expect(getContext(page).app.dateError).toHaveText(/\S/);
});

When("ik een afspraak verstuur zonder reden gesprek", async ({ page }) => {
  const app = getContext(page).app;
  let createRequests = 0;
  const count = (request: { method(): string; url(): string }) => {
    if (request.method() === "POST" && request.url().endsWith("/api/appointments")) {
      createRequests += 1;
    }
  };
  page.on("request", count);
  await app.create({ date: nextWorkday(new Date()), reason: "", expectCreated: false });
  page.off("request", count);
  Object.assign(getContext(page), { createRequests });
});

Then("wordt de reden gesprek als verplicht gemeld", async ({ page }) => {
  expect(
    await getContext(page).app.reason.evaluate(
      (el: HTMLTextAreaElement) => el.validity.valueMissing,
    ),
  ).toBe(true);
});

Then("is de afspraakduur uitgeschakeld en ingesteld op 30 minuten", async ({ page }) => {
  const app = getContext(page).app;
  await expect(app.duration).toBeDisabled();
  await expect(app.duration).toHaveValue("30");
});

When("ik een afspraak aanvraag met HTML-, XSS- en SQL-achtige tekens", async ({ page }) => {
  const date = nextScheduledWorkday(new Date(), await defaultConsultantWorkdays(page));
  let dialogSeen = false;
  page.on("dialog", (dialog) => {
    dialogSeen = true;
    void dialog.dismiss();
  });
  Object.assign(getContext(page), { dialogSeen: () => dialogSeen });

  const reason =
    `<script>alert(1)</script> '; DROP TABLE afspraken;-- ${uniqueReason("XSS")}`;
  await createAppointment(page, date, reason, { date, reason });
});

Then("wordt de reden letterlijk als tekst getoond", async ({ page }) => {
  const { app, date, reason, range, consultantName } = getContext(page);
  await app.goToWeekOf(date);
  await app.expectCard(date, reason, { range, consultantName });
});

Then("wordt geen dialoogvenster geopend", async ({ page }) => {
  const context = getContext(page) as ScenarioContext & { dialogSeen: () => boolean };
  expect(context.dialogSeen()).toBe(false);
});

When("ik een reden langer dan 200 tekens invoer", async ({ page }) => {
  const date = nextScheduledWorkday(new Date(), await defaultConsultantWorkdays(page));
  const id = uniqueReason("Lang");
  const typed = `${id} ${"x".repeat(250)}`;
  const expected = typed.slice(0, 200);
  await createAppointment(page, date, typed, {
    date,
    reason: typed,
    typeReason: true,
  });
  Object.assign(getContext(page), { expectedNotes: expected, id });
});

Then("wordt maximaal 200 tekens getoond", async ({ page }) => {
  const { app, date, reason, range, consultantName, expectedNotes, id } =
    getContext(page) as ScenarioContext & { expectedNotes: string; id: string };
  await app.goToWeekOf(date);
  await app.expectCard(date, id, {
    range,
    consultantName,
    notes: expectedNotes,
  });
});

Then("blijft de agendakaart binnen de kolom", async ({ page }) => {
  const { app, date, id } = getContext(page) as ScenarioContext & { id: string };
  const card = app.cardIn(date, id);
  const overflows = await card.evaluate(
    (el) => el.scrollWidth > el.clientWidth + 1,
  );
  expect(overflows).toBe(false);
});
