import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  depositQuote,
  parseDepositPolicy,
  parsePaymentDetails,
  parsePaymentLabel,
  parsePaymentReference,
  toPublicBookingPolicy,
} from './booking-payments';

describe('booking payment policy', () => {
  it('keeps a spa without a deposit', () => {
    expect(parseDepositPolicy({ mode: 'NONE' })).toEqual({
      remoteDepositMode: 'NONE',
      remoteDepositValue: null,
      remoteDepositCurrency: null,
      paymentReviewHoldMinutes: 240,
    });
  });

  it('accepts a percentage and a fixed amount in a known currency', () => {
    expect(parseDepositPolicy({ mode: 'PERCENT', value: 50 }).remoteDepositValue).toBe(50);
    expect(parseDepositPolicy({ mode: 'FIXED', value: 10, currency: 'USD', holdMinutes: 180 })).toMatchObject({
      remoteDepositMode: 'FIXED',
      remoteDepositValue: 10,
      remoteDepositCurrency: 'USD',
      paymentReviewHoldMinutes: 180,
    });
  });

  it('quotes a percentage of the service total and a fixed amount as declared', () => {
    expect(depositQuote({
      mode: 'PERCENT',
      percent: 50,
      fixedAmount: null,
      fixedCurrency: null,
      serviceTotal: new Prisma.Decimal('19.99'),
      serviceCurrency: 'USD',
    })).toEqual({ amount: new Prisma.Decimal('10.00'), currency: 'USD' });
    expect(depositQuote({
      mode: 'FIXED',
      percent: null,
      fixedAmount: 15,
      fixedCurrency: 'VES',
      serviceTotal: new Prisma.Decimal('80'),
      serviceCurrency: 'USD',
    }).currency).toBe('VES');
    expect(() => parsePaymentReference('abc')).toThrow(BadRequestException);
    expect(parsePaymentReference('  1234-AB  ')).toBe('1234-AB');
  });

  it('rejects a deposit without the fields that mode requires', () => {
    expect(() => parseDepositPolicy({ mode: 'NONE', value: 10 })).toThrow(BadRequestException);
    expect(() => parseDepositPolicy({ mode: 'PERCENT', value: 50, currency: 'USD' })).toThrow(BadRequestException);
    expect(() => parseDepositPolicy({ mode: 'FIXED', value: 10 })).toThrow(BadRequestException);
    expect(() => parseDepositPolicy({ mode: 'PERCENT', value: 0 })).toThrow(BadRequestException);
  });

  it('keeps only the fields that belong to each payment method', () => {
    expect(parsePaymentDetails('PAGO_MOVIL', {
      phone: '0414-1234567',
      nationalId: '12.345.678',
      bank: '0134 - Banesco',
      extra: 'no',
    })).toEqual({ phone: '04141234567', nationalId: '12345678', bank: '0134 - Banesco' });
    expect(() => parsePaymentDetails('PAGO_MOVIL', {
      phone: '04141234567',
      nationalId: '12345678',
      bank: 'Banesco',
    })).toThrow(BadRequestException);
    expect(parsePaymentDetails('ZELLE', { holder: 'Ana Pérez', email: 'Ana@Example.com' })).toEqual({
      holder: 'Ana Pérez',
      email: 'ana@example.com',
    });
    expect(() => parsePaymentDetails('PAYPAL', { email: '' })).toThrow(BadRequestException);
  });

  it('publishes the active methods and hides inactive ones', () => {
    const policy = toPublicBookingPolicy(
      {
        remoteDepositMode: 'PERCENT',
        remoteDepositValue: 50,
        remoteDepositCurrency: null,
        paymentReviewHoldMinutes: 240,
      },
      [
        { id: 'off', type: 'ZELLE', label: 'Zelle', requiresProof: true, details: {}, isActive: false, sortOrder: 0 },
        { id: 'on', type: 'PAGO_MOVIL', label: 'Pago móvil', requiresProof: false, details: { bank: 'Banesco' }, isActive: true, sortOrder: 1 },
      ],
    );
    expect(policy.deposit).toEqual({ mode: 'PERCENT', percent: 50 });
    expect(policy.methods.map((method) => method.id)).toEqual(['on']);
  });

  it('normalizes the method name', () => {
    expect(parsePaymentLabel('  Pago   móvil  ')).toBe('Pago móvil');
  });
});
