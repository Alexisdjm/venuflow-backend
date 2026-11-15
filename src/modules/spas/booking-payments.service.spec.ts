import { ConflictException } from '@nestjs/common';
import { BookingPaymentsService } from './booking-payments.service';

describe('BookingPaymentsService', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const policy = {
    remoteDepositMode: 'NONE',
    remoteDepositValue: null,
    remoteDepositCurrency: null,
    paymentReviewHoldMinutes: 240,
  };

  beforeEach(() => jest.clearAllMocks());

  it('refuses a deposit until the spa has an active payment method', async () => {
    const prisma = {
      spa: { findUnique: jest.fn().mockResolvedValue(policy), update: jest.fn() },
      spaPaymentMethod: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new BookingPaymentsService(prisma as never, audit as never);

    await expect(
      service.updatePolicy('actor', 'spa-1', { mode: 'PERCENT', value: 50 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.spa.update).not.toHaveBeenCalled();
  });

  it('stores a payment method and audits it', async () => {
    const prisma = {
      spa: { findUnique: jest.fn().mockResolvedValue(policy) },
      spaPaymentMethod: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'method-1',
          type: 'PAGO_MOVIL',
          label: 'Pago móvil',
          details: { phone: '04141234567', nationalId: '12345678', bank: '0134 - Banesco' },
          requiresProof: false,
          isActive: true,
          sortOrder: 0,
        }),
      },
    };
    const service = new BookingPaymentsService(prisma as never, audit as never);

    const method = await service.createMethod('actor', 'spa-1', {
      type: 'PAGO_MOVIL',
      label: 'Pago móvil',
      details: { phone: '04141234567', nationalId: '12345678', bank: '0134 - Banesco' },
    });

    expect(method.requiresProof).toBe(false);
    expect(prisma.spaPaymentMethod.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ spaId: 'spa-1', sortOrder: 0, requiresProof: false }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SPA_PAYMENT_METHOD_CREATED', entityId: 'method-1' }),
    );
  });

  it('keeps the last active method while a deposit is enabled', async () => {
    const prisma = {
      spa: { findUnique: jest.fn().mockResolvedValue({ ...policy, remoteDepositMode: 'PERCENT' }) },
      spaPaymentMethod: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'method-1',
          type: 'ZELLE',
          label: 'Zelle',
          details: { holder: 'Ana', email: 'ana@example.com' },
          requiresProof: true,
          isActive: true,
          sortOrder: 0,
        }),
        count: jest.fn().mockResolvedValue(0),
        delete: jest.fn(),
      },
    };
    const service = new BookingPaymentsService(prisma as never, audit as never);

    await expect(service.deleteMethod('actor', 'spa-1', 'method-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.spaPaymentMethod.delete).not.toHaveBeenCalled();
  });
});
