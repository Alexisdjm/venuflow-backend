import { DateTime } from 'luxon';

export const PLATFORM_TIMEZONE = 'America/Caracas';

export type CalendarDate = { year: number; month: number; day: number };

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function calendarDate(zone: string, now = DateTime.now()): CalendarDate {
  const local = now.setZone(zone);
  const zoned = local.isValid ? local : now.setZone(PLATFORM_TIMEZONE);
  return { year: zoned.year, month: zoned.month, day: zoned.day };
}

export function nextBillingDate(dueDay: number, today: CalendarDate): CalendarDate {
  const thisMonthDay = Math.min(dueDay, daysInMonth(today.year, today.month));
  if (today.day <= thisMonthDay) {
    return { year: today.year, month: today.month, day: thisMonthDay };
  }
  const month = today.month === 12 ? 1 : today.month + 1;
  const year = today.month === 12 ? today.year + 1 : today.year;
  return { year, month, day: Math.min(dueDay, daysInMonth(year, month)) };
}

export function billingDateIso(date: CalendarDate) {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

export function daysUntil(today: CalendarDate, date: CalendarDate) {
  const start = Date.UTC(today.year, today.month - 1, today.day);
  const end = Date.UTC(date.year, date.month - 1, date.day);
  return Math.round((end - start) / 86_400_000);
}

export function billingReached(dueDay: number, today: CalendarDate) {
  return today.day >= Math.min(dueDay, daysInMonth(today.year, today.month));
}

export function billingSnapshot(
  dueDay: number | null,
  timezone: string,
  now = DateTime.now(),
) {
  if (dueDay == null) {
    return { nextDueDate: null, upcoming: false, attention: 'unconfigured' as const };
  }
  const today = calendarDate(timezone, now);
  const next = nextBillingDate(dueDay, today);
  return {
    nextDueDate: billingDateIso(next),
    upcoming: daysUntil(today, next) <= 6,
    attention: billingReached(dueDay, today) ? ('reached' as const) : null,
  };
}
