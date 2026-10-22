import { test, expect, Page, Locator } from '@playwright/test';
import { AppointmentPage } from './pages/appointment-page';
import { LoginPage } from './pages/login-page';

/* ------------------------------------------------------------------ */
/* CONFIGURATIE                                                        */
/* ------------------------------------------------------------------ */
const CONFIG = {
  loginUrl: '/login',
  appointmentUrl: '/dashboard', // pagina met het formulier "Afspraak voorstellen"
  user: {
    username: process.env.E2E_CLIENT_USERNAME ?? 'testuser',
    password: process.env.E2E_CLIENT_PASSWORD ?? 'Test1234!',
  },
  firstStartHour: 8, // eerste optie in dropdown "Uur"
  lastStartHour: 17, // laatste optie in dropdown "Uur"
  minuteOptions: ['00', '15', '30', '45'],
  status: /Status:\s*aangevraagd/i, // eerste regel met notities op het agendakaartje
  notesMaxLength: 200, // maxlength van "Reden gesprek"
};

/* ------------------------------------------------------------------ */
/* DATUM-HELPERS (alles is relatief aan de systeemdatum)               */
/* ------------------------------------------------------------------ */
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`; // 22-10-2026
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // 2026-10-22

const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Maandag van de week waarin d valt. */
const mondayOf = (d: Date) => {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
};
const sameWeek = (a: Date, b: Date) => sameDay(mondayOf(a), mondayOf(b));
const weeksBetween = (from: Date, to: Date) =>
  Math.round((mondayOf(to).getTime() - mondayOf(from).getTime()) / (7 * DAY_MS));
const monthsBetween = (from: Date, to: Date) =>
  (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());

/** Eerstvolgende werkdag na `from` (ma t/m vr). */
const nextWorkday = (from: Date) => {
  let d = addDays(from, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
};
const nextSaturday = (from: Date) => {
  let d = addDays(from, 1);
  while (d.getDay() !== 6) d = addDays(d, 1);
  return d;
};
/** Donderdag van volgende week. */
const thursdayNextWeek = (from: Date) => addDays(mondayOf(from), 7 + 3);
/** Positie van de dag in de agenda: maandag = 0 ... vrijdag = 4. */
const dayIndex = (d: Date) => (d.getDay() + 6) % 7;

/* ------------------------------------------------------------------ */
/* TIJD-HELPERS                                                        */
/* ------------------------------------------------------------------ */
type Slot = { hour: number; minute: string };

/** Willekeurige begintijd tussen 10 en 15 uur (voorkomt botsingen met bestaande afspraken om 09:00). */
const randomSlot = (): Slot => ({
  hour: 10 + Math.floor(Math.random() * 6),
  minute: CONFIG.minuteOptions[Math.floor(Math.random() * CONFIG.minuteOptions.length)],
});

/** Bijv. slot 10:45 + 30 min => "10:45 - 11:15" (zoals op het agendakaartje). */
const timeRange = (slot: Slot, durationMin: number) => {
  const start = slot.hour * 60 + Number(slot.minute);
  const end = start + durationMin;
  return `${pad(slot.hour)}:${slot.minute} - ${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
};

const uniqueReason = (prefix = 'Intake') => `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;


/* ------------------------------------------------------------------ */
/* TESTS                                                               */
/* ------------------------------------------------------------------ */
test.describe('Afspraak aanvragen', () => {
  let app: AppointmentPage;

  // De beforeEach regelt het inloggen EN het openen van de pagina VOOR elke test
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    app = new AppointmentPage(page);

    // 1. Eerst inloggen via de LoginPage
    await page.goto(CONFIG.loginUrl);
    await loginPage.login(CONFIG.user.username, CONFIG.user.password);

    // 2. Daarna pas naar de AppointmentPage navigeren
    await app.open();
  });

  /* ---------------------------- POSITIEF --------------------------- */

  test('TC-01: geldige aanvraag verschijnt in de agenda (eerstvolgende werkdag)', async () => {
    const today = new Date();
    const date = nextWorkday(today);
    const reason = uniqueReason();
    const before = await app.counters();

    const { consultantName, range } = await app.create({ date, reason });

    // "Deze week" gaat alleen omhoog als de datum in de huidige week valt
    await app.expectCounters(before, { week: sameWeek(date, today) ? 1 : 0, today: 0, total: 1 });

    await app.goToWeekOf(date);
    await app.expectCard(date, reason, { range, consultantName });
  });

  test('TC-02: datum kiezen via kalender, afspraak volgende week zichtbaar na navigeren', async () => {
    const date = thursdayNextWeek(new Date());
    const reason = uniqueReason();
    const before = await app.counters();

    const { consultantName, range } = await app.create({ date, viaCalendar: true, reason });

    // Andere week: "Deze week" en "Vandaag" blijven gelijk, "Totaal" +1
    await app.expectCounters(before, { week: 0, today: 0, total: 1 });

    await app.goToWeekOf(date);
    await app.expectCard(date, reason, { range, consultantName });

    // "Vandaag" brengt de agenda terug naar de huidige week, waar het kaartje niet staat
    await app.currentWeek.click();
    await expect(app.cardIn(date, reason)).toHaveCount(0);
  });

  test('TC-03: aanvraag voor vandaag op een later tijdstip', async () => {
    const now = new Date();
    test.skip(isWeekend(now), 'Vandaag is een weekenddag: geen afspraken mogelijk');
    const hour = now.getHours() + 1;
    test.skip(hour < CONFIG.firstStartHour || hour > CONFIG.lastStartHour, 'Huidige tijd valt buiten de werktijd');

    const reason = uniqueReason();
    const before = await app.counters();
    const { consultantName, range } = await app.create({ date: now, slot: { hour, minute: '00' }, reason });

    await app.expectCounters(before, { week: 1, today: 1, total: 1 });

    await app.goToWeekOf(now);
    await app.expectCard(now, reason, { range, consultantName });
  });

  test('TC-04: eindtijd wordt juist berekend, ook over het hele uur heen (:45 + 30 min)', async () => {
    const date = nextWorkday(new Date());
    const reason = uniqueReason();
    const slot: Slot = { hour: 10 + Math.floor(Math.random() * 6), minute: '45' };

    const { consultantName, range } = await app.create({ date, slot, reason });

    expect(range).toBe(timeRange(slot, 30)); // bijv. "10:45 - 11:15"
    await app.goToWeekOf(date);
    await app.expectCard(date, reason, { range, consultantName });
  });

  /* ---------------------------- NEGATIEF --------------------------- */

  test('TC-05: verplichte velden locatie en consultant niet ingevuld', async () => {
    const date = nextWorkday(new Date());
    const reason = uniqueReason();
    const before = await app.counters();

    await app.create({ date, reason, location: null, consultant: null });

    // Browser blokkeert het versturen (required-velden)
    expect(await app.location.evaluate((el: HTMLSelectElement) => el.validity.valueMissing)).toBe(true);
    expect(await app.consultant.evaluate((el: HTMLSelectElement) => el.validity.valueMissing)).toBe(true);
    await app.expectNotCreated(before, date, reason);
  });

  test('TC-06: datum in het weekend wordt geweigerd', async () => {
    const date = nextSaturday(new Date());
    const reason = uniqueReason();
    const before = await app.counters();

    await app.create({ date, reason });

    await expect.soft(app.dateError).toHaveText(/\S/); // foutmelding bij de datum
    await app.expectNotCreated(before, date, reason);

    // In de kalender is de zaterdag niet te kiezen
    await expect(await app.calendarDay(date)).toBeDisabled();
  });

  test('TC-07: datum in het verleden wordt geweigerd', async () => {
    const today = new Date();
    const date = addDays(today, -1);
    const reason = uniqueReason();
    const before = await app.counters();

    await app.create({ date, reason });

    await expect.soft(app.dateError).toHaveText(/\S/);
    await app.expectNotCreated(before, date, reason);

    // In de kalender is gisteren niet te kiezen (alleen controleren binnen dezelfde maand)
    if (date.getMonth() === today.getMonth()) {
      await expect(await app.calendarDay(date)).toBeDisabled();
    }
  });

  test('TC-08a: "Reden gesprek" leeg laten wordt geweigerd', async () => {
    const date = nextWorkday(new Date());
    const before = await app.counters();

    await app.create({ date, reason: '' });

    expect(await app.reason.evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
    await app.expectNotCreated(before, date);
  });

  test('TC-08b: duur staat vast op 30 minuten en kan niet worden aangepast', async () => {
    await expect(app.duration).toBeDisabled();
    await expect(app.duration).toHaveValue('30');
  });

  /* ---------------------------- EDGE CASES ------------------------- */

  test('TC-09: overlappende afspraak bij dezelfde consultant wordt geweigerd', async () => {
    const date = nextWorkday(new Date());
    const hour = 10 + Math.floor(Math.random() * 6);
    const first = uniqueReason('Eerste');
    const second = uniqueReason('Tweede');
    const before = await app.counters();

    const one = await app.create({ date, slot: { hour, minute: '00' }, reason: first });
    await app.expectCounters(before, { week: sameWeek(date, new Date()) ? 1 : 0, today: 0, total: 1 });

    // Zelfde consultant, begint om :15 = overlapt met de eerste afspraak (:00 - :30)
    const afterFirst = await app.counters();
    await app.create({ date, slot: { hour, minute: '15' }, reason: second });

    await app.expectCounters(afterFirst, { week: 0, today: 0, total: 0 });
    await app.goToWeekOf(date);
    await app.expectCard(date, first, one);
    await expect(app.cardIn(date, second)).toHaveCount(0);
  });

  test('TC-10a: speciale tekens in "Reden gesprek" worden als tekst getoond (geen XSS)', async ({ page }) => {
    let dialogSeen = false;
    page.on('dialog', (dialog) => {
      dialogSeen = true;
      void dialog.dismiss();
    });

    const date = nextWorkday(new Date());
    const id = uniqueReason('XSS');
    const reason = `<script>alert(1)</script> '; DROP TABLE afspraken;-- ${id}`;
    const before = await app.counters();

    const { consultantName, range } = await app.create({ date, reason });

    await app.expectCounters(before, { week: sameWeek(date, new Date()) ? 1 : 0, today: 0, total: 1 });
    await app.goToWeekOf(date);
    await app.expectCard(date, id, { range, consultantName }); // let op: letterlijk als tekst, niet uitgevoerd
    await expect(app.cardIn(date, id).locator('.appointment-notes').nth(1)).toHaveText(reason);
    expect(dialogSeen).toBe(false);
  });

  test('TC-10b: tekst boven de maximumlengte (200) wordt afgekapt en breekt de agenda niet', async () => {
    const date = nextWorkday(new Date());
    const id = uniqueReason('Lang');
    const typed = `${id} ${'x'.repeat(CONFIG.notesMaxLength + 50)}`; // ruim boven de limiet, zonder spaties
    const expected = typed.slice(0, CONFIG.notesMaxLength);
    const before = await app.counters();

    const { consultantName, range } = await app.create({ date, reason: typed, typeReason: true });

    await app.expectCounters(before, { week: sameWeek(date, new Date()) ? 1 : 0, today: 0, total: 1 });
    await app.goToWeekOf(date);
    const card = await app.expectCard(date, id, { range, consultantName });
    await expect(card.locator('.appointment-notes').nth(1)).toHaveText(expected);

    // Kaartje loopt niet buiten zijn kolom
    const overflows = await card.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect.soft(overflows).toBe(false);
  });
});