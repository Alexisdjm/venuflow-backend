import { DateTime } from 'luxon';
import {
  pastBeyondGrace,
  professionalBusy,
  shiftCovers,
} from '../scheduling/scheduling.service';

export type PlanShift = { dayOfWeek: number; startMinute: number; endMinute: number };
export type PlanBusy = { professionalId: string; startAt: Date; endAt: Date };

const weekdayOrder = (day: number) => (day === 0 ? 7 : day);

export function suggestWeekdays(openDays: number[], count: number) {
  const open = [...new Set(openDays)].sort((a, b) => weekdayOrder(a) - weekdayOrder(b));
  const weekdays = open.filter((day) => day >= 1 && day <= 5);
  const weekend = open.filter((day) => day === 6 || day === 0);
  if (!weekdays.length) return spreadDays(open, count);
  if (count > weekdays.length) return [...weekdays, ...weekend].slice(0, count);
  if (count >= 4 && weekend.includes(6)) return [...spreadDays(weekdays, count - 1), 6];
  return spreadDays(weekdays, count);
}

function spreadDays(days: number[], count: number) {
  if (count <= 0 || !days.length) return [];
  if (count >= days.length) return days.slice(0, count);
  if (count === 1) return [days[Math.floor((days.length - 1) / 2)]];
  const picked: number[] = [];
  for (let index = 0; index < count; index += 1) {
    picked.push(days[Math.round((index * (days.length - 1)) / (count - 1))]);
  }
  return [...new Set(picked)];
}

export function packageRescheduleDates(input: {
  current: DateTime;
  otherDates: string[];
  openDays: number[];
  preferredWeekdays: number[];
  sessionsPerWeek: number;
}) {
  const zone = input.current.zoneName ?? 'utc';
  const weekStart = input.current.startOf('day').minus({ days: input.current.weekday - 1 });
  const occupied = new Set(input.otherDates);
  const sameWeek: string[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = weekStart.plus({ days: offset });
    const key = day.toISODate();
    const weekday = day.weekday % 7;
    if (!key || !input.openDays.includes(weekday)) continue;
    if (occupied.has(key)) continue;
    sameWeek.push(key);
  }
  const preferred = input.preferredWeekdays.filter((day) => input.openDays.includes(day));
  const allowedDays = preferred.length ? preferred : input.openDays;
  const latest = [...input.otherDates].sort().at(-1);
  let cursor = latest
    ? DateTime.fromISO(latest, { zone }).plus({ days: 1 }).startOf('day')
    : input.current.startOf('day').plus({ days: 1 });
  let tail: string | null = null;
  for (let step = 0; step < 70 && !tail; step += 1) {
    const key = cursor.toISODate();
    const weekday = cursor.weekday % 7;
    const week = packageWeekBounds(cursor).key;
    const inWeek = input.otherDates.filter(
      (date) => packageWeekBounds(DateTime.fromISO(date, { zone })).key === week,
    ).length;
    if (key && allowedDays.includes(weekday) && !occupied.has(key) && inWeek < input.sessionsPerWeek) {
      tail = key;
    } else {
      cursor = cursor.plus({ days: 1 });
    }
  }
  return {
    sameWeek: sameWeek.sort(),
    tail: tail && !sameWeek.includes(tail) ? tail : null,
  };
}

export function packageWeekBounds(local: DateTime) {
  const start = local.startOf('day').minus({ days: local.weekday - 1 });
  return {
    key: start.toISODate()!,
    start: start.toUTC().toJSDate(),
    end: start.plus({ weeks: 1 }).toUTC().toJSDate(),
  };
}

export function placePackageSessions(input: {
  firstStart: DateTime;
  durationMinutes: number;
  sessionCount: number;
  sessionsPerWeek: number;
  preferredWeekdays: number[];
  professionalId: string;
  shifts: PlanShift[];
  busy: PlanBusy[];
  takenDates: Set<string>;
  expiresAt?: Date | null;
  graceMinutes: number;
}) {
  const placed: { start: DateTime; end: DateTime }[] = [];
  const weekCounts = new Map<string, number>();
  const taken = new Set(input.takenDates);
  const busy = [...input.busy];
  const first = input.firstStart;
  const preferredMinute = first.hour * 60 + first.minute;
  const horizon = first.startOf('day').plus({ days: Math.max(input.sessionCount * 21, 60) });
  const expires = input.expiresAt ? DateTime.fromJSDate(input.expiresAt) : null;

  for (
    let day = first.startOf('day');
    placed.length < input.sessionCount && day < horizon;
    day = day.plus({ days: 1 })
  ) {
    const weekday = day.weekday % 7;
    if (!input.preferredWeekdays.includes(weekday)) continue;
    const week = packageWeekBounds(day);
    if ((weekCounts.get(week.key) ?? 0) >= input.sessionsPerWeek) continue;
    const dateKey = day.toISODate();
    if (!dateKey || taken.has(dateKey)) continue;
    const minutes = day.hasSame(first, 'day')
      ? [preferredMinute]
      : minutesForDay(input.shifts, weekday, input.durationMinutes, preferredMinute);
    const slot = minutes
      .map((minute) => slotAt(day, minute, input.durationMinutes, input.shifts, weekday))
      .find((candidate) =>
        candidate
          ? fits(candidate, input, busy, expires)
          : false,
      );
    if (!slot) {
      if (day.hasSame(first, 'day')) {
        return { sessions: [], missing: input.sessionCount, firstPlaced: false };
      }
      continue;
    }
    placed.push(slot);
    weekCounts.set(week.key, (weekCounts.get(week.key) ?? 0) + 1);
    taken.add(dateKey);
    busy.push({
      professionalId: input.professionalId,
      startAt: slot.start.toJSDate(),
      endAt: slot.end.toJSDate(),
    });
  }

  return {
    sessions: placed,
    missing: input.sessionCount - placed.length,
    firstPlaced: placed.length > 0,
  };
}

function minutesForDay(
  shifts: PlanShift[],
  weekday: number,
  durationMinutes: number,
  preferredMinute: number,
) {
  const later: number[] = [];
  const earlier: number[] = [];
  for (const shift of shifts.filter((item) => item.dayOfWeek === weekday)) {
    const first = Math.ceil(shift.startMinute / 30) * 30;
    for (let minute = first; minute + durationMinutes <= shift.endMinute; minute += 30) {
      if (minute === preferredMinute) continue;
      if (minute > preferredMinute) later.push(minute);
      else earlier.push(minute);
    }
  }
  return [preferredMinute, ...later, ...earlier];
}

function slotAt(
  day: DateTime,
  minute: number,
  durationMinutes: number,
  shifts: PlanShift[],
  weekday: number,
) {
  const covered = shifts.some(
    (shift) =>
      shift.dayOfWeek === weekday &&
      shiftCovers(shift, minute, minute + durationMinutes),
  );
  if (!covered) return null;
  const start = day.plus({ minutes: minute });
  return { start, end: start.plus({ minutes: durationMinutes }) };
}

function fits(
  slot: { start: DateTime; end: DateTime },
  input: {
    professionalId: string;
    graceMinutes: number;
  },
  busy: PlanBusy[],
  expires: DateTime | null,
) {
  if (expires && slot.start.toUTC() > expires.toUTC()) return false;
  if (pastBeyondGrace(slot.start, input.graceMinutes)) return false;
  return !professionalBusy(
    busy,
    input.professionalId,
    slot.start.toJSDate(),
    slot.end.toJSDate(),
  );
}
