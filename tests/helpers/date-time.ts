export type Slot = { hour: number; minute: string };

const weekdayNames = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];

export const pad = (value: number) => String(value).padStart(2, '0');

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export const isWeekend = (date: Date) => date.getDay() === 0 || date.getDay() === 6;
export const sameDay = (first: Date, second: Date) => first.toDateString() === second.toDateString();

export function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

export const sameWeek = (first: Date, second: Date) => sameDay(mondayOf(first), mondayOf(second));

export function nextWorkday(from: Date): Date {
  let date = addDays(from, 1);
  while (isWeekend(date)) date = addDays(date, 1);
  return date;
}

export function nextScheduledWorkday(from: Date, workdays: string): Date {
  let date = addDays(from, 1);
  const scheduledDays = workdays.toLocaleLowerCase('nl-NL');
  while (!scheduledDays.includes(weekdayNames[date.getDay()].toLocaleLowerCase('nl-NL'))) {
    date = addDays(date, 1);
  }
  return date;
}

export function nextSaturday(from: Date): Date {
  let date = addDays(from, 1);
  while (date.getDay() !== 6) date = addDays(date, 1);
  return date;
}

export const thursdayNextWeek = (from: Date) => addDays(mondayOf(from), 10);

export function formatISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDateInput(date: Date): string {
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export function timeRange(slot: Slot, durationMin: number): string {
  const start = slot.hour * 60 + Number(slot.minute);
  const end = start + durationMin;
  return `${pad(slot.hour)}:${slot.minute} - ${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
}
