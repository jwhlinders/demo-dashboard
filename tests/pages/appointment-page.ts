import { expect, type Page, type Locator } from '@playwright/test';

type Counters = { week: number; today: number; total: number };

type CreateOptions = {
  date: Date;
  viaCalendar?: boolean; // datum kiezen met het kalenderpopupje i.p.v. typen
  slot?: Slot;
  reason: string;
  typeReason?: boolean; // tekens echt typen (maxlength geldt dan wel; bij fill() niet)
  location?: number | null; // index in dropdown (1 = eerste echte keuze), null = niet kiezen
  consultant?: number | null;
};


function fmt(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0'); // Maanden zijn 0-indexed
  const year = d.getFullYear();
  
  return `${day}-${month}-${year}`; // Geeft keurig 'dd-mm-jjjj' terug
}

//helper toe voor het berekenen van de maanden tussen twee datums
function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

//helper voor het genereren van een schone ISO-datum (YYYY-MM-DD)
function iso(d: Date): string {
  return d.toLocaleDateString('sv-SE'); 
}

export class AppointmentPage {
  readonly date: Locator;
  readonly dateError: Locator;
  readonly calendarButton: Locator;
  readonly calendar: Locator;
  readonly location: Locator;
  readonly consultant: Locator;
  readonly hour: Locator;
  readonly minute: Locator;
  readonly duration: Locator;
  readonly reason: Locator;
  readonly submit: Locator;
  readonly previousWeek: Locator;
  readonly currentWeek: Locator;
  readonly nextWeek: Locator;
  readonly weekLabel: Locator;

  constructor(private page: Page) {
    this.date = page.locator('#appointment-date');
    this.dateError = page.locator('#appointment-date-error');
    this.calendarButton = page.locator('#appointment-date-picker');
    this.calendar = page.locator('#appointment-date-calendar');
    this.location = page.locator('#appointment-location');
    this.consultant = page.locator('#appointment-consultant');
    this.hour = page.locator('#appointment-hour');
    this.minute = page.locator('#appointment-minute');
    this.duration = page.locator('#appointment-duration');
    this.reason = page.locator('#appointment-notes');
    this.submit = page.locator('#form-submit-button');
    this.previousWeek = page.locator('#previous-week');
    this.currentWeek = page.locator('#current-week');
    this.nextWeek = page.locator('#next-week');
    this.weekLabel = page.locator('#week-label');
  }

  async open(): Promise<void> {
    // Alleen navigeren, niet inloggen!
    this.page.goto('/dashboard');
    await expect(this.submit).toBeVisible();
  }

  /* ----------------------------- Tellers --------------------------- */

  /** Lees een teller uit de kaarten bovenaan ("Vandaag", "Afspraken in deze week", "Totaal gepland"). */
  private async counter(label: string): Promise<number> {
    const text = await this.page.getByText(label, { exact: true }).first().locator('xpath=..').innerText();
    const match = text.match(/(\d+)\s*afspra/i);
    if (!match) throw new Error(`Teller "${label}" niet gevonden in: ${text}`);
    return Number(match[1]);
  }

  async counters(): Promise<Counters> {
    return {
      week: await this.counter('Afspraken in deze week'),
      today: await this.counter('Vandaag'),
      total: await this.counter('Totaal gepland'),
    };
  }

  async expectCounters(before: Counters, delta: Counters) {
    await expect.poll(() => this.counters()).toEqual({
      week: before.week + delta.week,
      today: before.today + delta.today,
      total: before.total + delta.total,
    });
  }

  /* ----------------------------- Formulier ------------------------- */

  async setDate(d: Date) {
    await this.date.fill(fmt(d)); // dd-mm-jjjj
    await this.date.blur();
  }

  /** Kalenderpopup openen en naar de maand van `date` navigeren. Geeft de dagknop terug. */
  async calendarDay(date: Date): Promise<Locator> {
    await this.calendarButton.click();
    await expect(this.calendar).toBeVisible();
    const months = monthsBetween(new Date(), date);
    for (let i = 0; i < Math.abs(months); i++) {
      await this.calendar.locator(months > 0 ? '[data-calendar-next]' : '[data-calendar-previous]').click();
    }
    return this.calendar.locator(`button[data-date="${iso(date)}"]`);
  }

  async pickViaCalendar(date: Date) {
    const day = await this.calendarDay(date);
    await expect(day).toBeEnabled();
    await day.click();
    await expect(this.date).toHaveValue(fmt(date));
  }

  /** Vult het formulier in en verstuurt het. Geeft de gekozen consultant en tijdrange terug. */
  async create(opts: CreateOptions) {
    const slot = opts.slot ?? randomSlot();

    if (opts.viaCalendar) await this.pickViaCalendar(opts.date);
    else await this.setDate(opts.date);

    if (opts.location !== null) await this.location.selectOption({ index: opts.location ?? 1 });
    if (opts.consultant !== null) await this.consultant.selectOption({ index: opts.consultant ?? 1 });
    await this.hour.selectOption(pad(slot.hour));
    await this.minute.selectOption(slot.minute);

    if (opts.typeReason) await this.reason.pressSequentially(opts.reason);
    else await this.reason.fill(opts.reason);

    // Duur is voor een cliënt vergrendeld: lees de waarde uit het veld
    const duration = Number(await this.duration.inputValue());
    const consultantName =
      opts.consultant === null ? '' : (await this.consultant.locator('option:checked').innerText()).trim();

    await this.submit.click();
    return { consultantName, range: timeRange(slot, duration) };
  }

  /* ------------------------------ Agenda --------------------------- */

  /** Agenda naar de week van `date` brengen: eerst "Vandaag", dan ‹ of › klikken. */
  async goToWeekOf(date: Date) {
    await this.currentWeek.click();
    const weeks = weeksBetween(new Date(), date);
    const arrow = weeks >= 0 ? this.nextWeek : this.previousWeek;
    for (let i = 0; i < Math.abs(weeks); i++) await arrow.click();

    // Weeklabel controleren, bijv. "26 - 30 oktober 2026"
    const monday = mondayOf(date);
    const friday = addDays(monday, 4);
    await expect(this.weekLabel).toHaveText(new RegExp(`^\\s*${monday.getDate()}\\b.*\\b${friday.getDate()}\\b`));
  }

  /** Kolom van de dag (maandag t/m vrijdag) in de agenda. */
  dayColumn(date: Date): Locator {
    return this.page.locator('.calendar-day').nth(dayIndex(date));
  }

  /** Agendakaartje met de gegeven reden, uitsluitend in de kolom van de juiste dag. */
  cardIn(date: Date, reason: string): Locator {
    return this.dayColumn(date).locator('article.appointment-card').filter({ hasText: reason });
  }

  /** Controleert tijd, consultant, status en reden van het kaartje in de juiste dagkolom. */
  async expectCard(date: Date, reason: string, expected: { range: string; consultantName: string }) {
    const card = this.cardIn(date, reason);
    await expect(this.dayColumn(date).locator('.day-number')).toHaveText(String(date.getDate()));
    await expect(card).toHaveCount(1);
    await expect(card.locator('.appointment-time')).toHaveText(expected.range); // 10:00 - 10:30
    await expect(card.locator('.appointment-client')).toHaveText(expected.consultantName); // consultant
    await expect(card.locator('.appointment-notes').first()).toHaveText(CONFIG.status); // Status: aangevraagd
    await expect(card.locator('.appointment-notes').nth(1)).toHaveText(reason); // reden gesprek
    return card;
  }

  /** Controleert dat er niets is aangemaakt: tellers gelijk en (optioneel) geen kaartje in de juiste week. */
  async expectNotCreated(before: Counters, date: Date, reason?: string) {
    await this.expectCounters(before, { week: 0, today: 0, total: 0 });
    if (reason) {
      await this.goToWeekOf(date);
      await expect(this.cardIn(date, reason)).toHaveCount(0);
    }
  }
}