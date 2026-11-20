import { DateTime } from 'luxon';
import {
  packageRescheduleDates,
  packageWeekBounds,
  placePackageSessions,
  suggestWeekdays,
} from './package-plan';

const zone = 'America/Caracas';
const shifts = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startMinute: 8 * 60,
  endMinute: 17 * 60,
}));

function at(iso: string) {
  return DateTime.fromISO(iso, { zone });
}

describe('suggested package days', () => {
  it('spaces three sessions on Monday, Wednesday and Friday', () => {
    expect(suggestWeekdays([1, 2, 3, 4, 5, 6], 3)).toEqual([1, 3, 5]);
  });

  it('adds Saturday only when four sessions need it', () => {
    expect(suggestWeekdays([1, 2, 3, 4, 5, 6], 4)).toEqual([1, 3, 5, 6]);
  });

  it('does not suggest Sunday when the office is closed', () => {
    expect(suggestWeekdays([1, 2, 3, 4, 5], 2)).toEqual([1, 5]);
  });
});

describe('package reschedule dates', () => {
  it('offers the free open days of the same week and then the tail', () => {
    const dates = packageRescheduleDates({
      current: at('2026-12-07T10:00:00'),
      otherDates: ['2026-12-09', '2026-12-11', '2026-12-14', '2026-12-16', '2026-12-18'],
      openDays: [1, 2, 3, 4, 5, 6],
      preferredWeekdays: [1, 3, 5],
      sessionsPerWeek: 3,
    });
    expect(dates.sameWeek).toEqual(['2026-12-07', '2026-12-08', '2026-12-10', '2026-12-12']);
    expect(dates.tail).toBe('2026-12-21');
  });
});

describe('package week', () => {
  it('starts the week on Monday', () => {
    const friday = at('2026-12-11T10:00:00');
    expect(packageWeekBounds(friday).key).toBe('2026-12-07');
  });
});

describe('package session placement', () => {
  it('spreads three sessions a week across the chosen days', () => {
    const plan = placePackageSessions({
      firstStart: at('2026-12-07T10:00:00'),
      durationMinutes: 60,
      sessionCount: 6,
      sessionsPerWeek: 3,
      preferredWeekdays: [1, 3, 5],
      professionalId: 'pro',
      shifts,
      busy: [],
      takenDates: new Set(),
      graceMinutes: 15,
    });
    expect(plan.firstPlaced).toBe(true);
    expect(plan.missing).toBe(0);
    expect(plan.sessions.map((session) => session.start.toISODate())).toEqual([
      '2026-12-07',
      '2026-12-09',
      '2026-12-11',
      '2026-12-14',
      '2026-12-16',
      '2026-12-18',
    ]);
    const weeks = plan.sessions.map((session) => packageWeekBounds(session.start).key);
    expect(weeks.filter((week) => week === '2026-12-07')).toHaveLength(3);
    expect(weeks.filter((week) => week === '2026-12-14')).toHaveLength(3);
  });

  it('moves a blocked hour later the same day and keeps the weekly cap', () => {
    const plan = placePackageSessions({
      firstStart: at('2026-12-07T10:00:00'),
      durationMinutes: 60,
      sessionCount: 2,
      sessionsPerWeek: 1,
      preferredWeekdays: [1],
      professionalId: 'pro',
      shifts,
      busy: [
        {
          professionalId: 'pro',
          startAt: at('2026-12-14T10:00:00').toJSDate(),
          endAt: at('2026-12-14T11:00:00').toJSDate(),
        },
      ],
      takenDates: new Set(),
      graceMinutes: 15,
    });
    expect(plan.sessions[1].start.toISO()).toBe(at('2026-12-14T11:00:00').toISO());
    expect(plan.missing).toBe(0);
  });

  it('rejects a first session outside the professional shift', () => {
    const plan = placePackageSessions({
      firstStart: at('2026-12-07T07:00:00'),
      durationMinutes: 60,
      sessionCount: 2,
      sessionsPerWeek: 1,
      preferredWeekdays: [1],
      professionalId: 'pro',
      shifts,
      busy: [],
      takenDates: new Set(),
      graceMinutes: 15,
    });
    expect(plan.firstPlaced).toBe(false);
    expect(plan.sessions).toHaveLength(0);
  });
});
