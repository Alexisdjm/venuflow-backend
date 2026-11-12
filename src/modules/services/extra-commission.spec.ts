import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  effectiveCommissionRate,
  normalizeExtraCommission,
} from './extra-commission';

describe('extra commission', () => {
  it('adds the service percentage to the professional rate', () => {
    expect(
      effectiveCommissionRate(new Prisma.Decimal(40), {
        extraCommission: true,
        extraCommissionRate: new Prisma.Decimal(10),
      }).toString(),
    ).toBe('50');
  });

  it('keeps the professional rate when the option is off', () => {
    expect(
      effectiveCommissionRate('40', {
        extraCommission: false,
        extraCommissionRate: '10',
      }).toString(),
    ).toBe('40');
  });

  it('caps the appointment commission at 100 percent', () => {
    expect(
      effectiveCommissionRate(95, {
        extraCommission: true,
        extraCommissionRate: 10,
      }).toString(),
    ).toBe('100');
  });

  it('stores a positive extra rate and clears it when the option is off', () => {
    expect(normalizeExtraCommission(true, '10').extraCommissionRate.toString()).toBe('10');
    const cleared = normalizeExtraCommission(false, '10');
    expect(cleared.extraCommission).toBe(false);
    expect(cleared.extraCommissionRate.toString()).toBe('0');
  });

  it('rejects an extra rate outside 0.01 and 100', () => {
    expect(() => normalizeExtraCommission(true, '0')).toThrow(BadRequestException);
    expect(() => normalizeExtraCommission(true, '101')).toThrow(BadRequestException);
    expect(() => normalizeExtraCommission(true, undefined)).toThrow(BadRequestException);
  });
});
