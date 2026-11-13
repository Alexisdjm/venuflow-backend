import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DateTime } from 'luxon';
import { UpdateOperatingHoursDto } from './dto/operating-hours.dto';
import { UpdateSpaDto } from './dto/spa.dto';
import {
  billingDateIso,
  billingSnapshot,
  daysInMonth,
  nextBillingDate,
} from './billing-due';

const date = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
};

describe('monthly billing due day', () => {
  it('repeats the configured day and rolls into the next month', () => {
    expect(billingDateIso(nextBillingDate(15, date('2026-03-10')))).toBe('2026-03-15');
    expect(billingDateIso(nextBillingDate(15, date('2026-03-15')))).toBe('2026-03-15');
    expect(billingDateIso(nextBillingDate(15, date('2026-03-16')))).toBe('2026-04-15');
    expect(billingDateIso(nextBillingDate(15, date('2026-12-20')))).toBe('2027-01-15');
  });

  it('uses the last available day in short months and leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(billingDateIso(nextBillingDate(29, date('2025-02-01')))).toBe('2025-02-28');
    expect(billingDateIso(nextBillingDate(29, date('2024-02-01')))).toBe('2024-02-29');
    expect(billingDateIso(nextBillingDate(30, date('2026-04-01')))).toBe('2026-04-30');
    expect(billingDateIso(nextBillingDate(30, date('2025-02-01')))).toBe('2025-02-28');
    expect(billingDateIso(nextBillingDate(31, date('2026-04-01')))).toBe('2026-04-30');
    expect(billingDateIso(nextBillingDate(31, date('2025-02-01')))).toBe('2025-02-28');
    expect(billingDateIso(nextBillingDate(31, date('2024-02-01')))).toBe('2024-02-29');
    expect(billingDateIso(nextBillingDate(31, date('2025-02-28')))).toBe('2025-02-28');
    expect(billingDateIso(nextBillingDate(31, date('2025-03-01')))).toBe('2025-03-31');
  });

  it('flags the next seven days and a reached review date without treating a missing day as due', () => {
    const now = DateTime.fromISO('2026-11-12T15:00:00', { zone: 'America/Caracas' });
    if (!now.isValid) throw new Error('Fecha de prueba inválida');
    expect(billingSnapshot(15, 'America/Caracas', now)).toMatchObject({
      nextDueDate: '2026-11-15',
      upcoming: true,
      attention: null,
    });
    expect(billingSnapshot(18, 'America/Caracas', now).upcoming).toBe(true);
    expect(billingSnapshot(19, 'America/Caracas', now).upcoming).toBe(false);
    expect(billingSnapshot(10, 'America/Caracas', now)).toMatchObject({
      nextDueDate: '2026-12-10',
      upcoming: false,
      attention: 'reached',
    });
    expect(billingSnapshot(null, 'America/Caracas', now)).toEqual({
      nextDueDate: null,
      upcoming: false,
      attention: 'unconfigured',
    });
  });

  it('accepts an empty due day and rejects a day outside 1 to 31', async () => {
    const cleared = plainToInstance(UpdateSpaDto, { status: 'ACTIVE', billingDueDay: '' });
    const numeric = plainToInstance(UpdateSpaDto, { status: 'ACTIVE', billingDueDay: '15' });
    const invalid = await validate(plainToInstance(UpdateSpaDto, { billingDueDay: 32 }));
    expect(await validate(cleared)).toEqual([]);
    expect(cleared.billingDueDay).toBeNull();
    expect(await validate(numeric)).toEqual([]);
    expect(numeric.billingDueDay).toBe(15);
    expect(invalid.map((error) => error.property)).toContain('billingDueDay');
  });

  it('rejects the due day on the spa administrator hours payload', async () => {
    const errors = await validate(
      plainToInstance(UpdateOperatingHoursDto, {
        openingMinute: 540,
        closingMinute: 1080,
        billingDueDay: 15,
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errors.map((error) => error.property)).toContain('billingDueDay');
  });
});
