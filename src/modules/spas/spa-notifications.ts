import { DateTime } from 'luxon';

export const PAYOUT_CADENCES = ['NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;
export type PayoutCadence = (typeof PAYOUT_CADENCES)[number];

const REMINDER_MINUTES = 30;

export function reminderUntil(now: Date) {
  return new Date(now.getTime() + REMINDER_MINUTES * 60_000);
}

export function isPayoutDay(now: Date, timezone: string, cadence: PayoutCadence) {
  if (cadence === 'NONE') return false;
  const local = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(timezone);
  if (!local.isValid) return false;
  if (cadence === 'MONTHLY') return local.day === 1;
  if (local.weekday !== 1) return false;
  if (cadence === 'WEEKLY') return true;
  return local.weekNumber % 2 === 0;
}

export function minutesUntil(start: Date, now: Date) {
  return Math.max(1, Math.ceil((start.getTime() - now.getTime()) / 60_000));
}

export function payoutCopy(cadence: Exclude<PayoutCadence, 'NONE'>) {
  if (cadence === 'WEEKLY') return 'Pago semanal a las profesionales';
  if (cadence === 'BIWEEKLY') return 'Pago quincenal a las profesionales';
  return 'Pago mensual a las profesionales';
}
