import { GoneException } from '@nestjs/common';
import { PublicBookingRequestsService } from './public-booking-requests.service';

describe('payment review queue', () => {
  const prisma = {
    bookingRequest: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (work: unknown) => {
      if (typeof work === 'function') return work(prisma);
      return Promise.all(work as Promise<unknown>[]);
    }),
  };
  const mail = {
    sendBookingPaymentRejected: jest.fn().mockResolvedValue(undefined),
    sendBookingConfirmed: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new PublicBookingRequestsService(
    prisma as never,
    mail as never,
    { get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? 'test-booking-secret' : undefined) } as never,
    audit as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('lists the payment, the client and the bolivar snapshot', async () => {
    prisma.bookingRequest.findMany.mockResolvedValue([reviewRow()]);
    prisma.bookingRequest.count.mockResolvedValue(1);

    const page = await service.reviewQueue('spa-1', 1, 20);

    expect(page.meta.total).toBe(1);
    expect(page.data[0]).toMatchObject({
      customerName: 'Ana Prueba',
      depositAmount: 7.5,
      depositVesAmount: 6837.18,
      exchangeSource: 'BCV',
      paymentReference: '123456',
      paymentSender: {
        nationalId: '12345678',
        phone: '04141234567',
        bank: '0134 - Banesco',
      },
      hasProof: true,
      professionalName: 'Jenny G',
    });
  });

  it('rejects a pending payment and tells the client', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue(openRequest());
    prisma.bookingRequest.update.mockResolvedValue({
      ...openRequest(),
      status: 'REJECTED',
    });

    const result = await service.rejectPayment('admin-1', 'spa-1', 'req-1');

    expect(prisma.bookingRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'REJECTED' } }),
    );
    expect(mail.sendBookingPaymentRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ana.prueba@example.com',
        reference: 'No pudimos validar el pago, así que el horario quedó libre.',
      }),
    );
    expect(result).toEqual({ status: 'REJECTED', emailSent: true });
  });

  it('frees an expired hold instead of approving it', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({
      ...openRequest(),
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.approvePayment('admin-1', 'spa-1', 'req-1')).rejects.toBeInstanceOf(
      GoneException,
    );
    expect(prisma.bookingRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXPIRED' } }),
    );
    expect(mail.sendBookingConfirmed).not.toHaveBeenCalled();
  });
});

function openRequest() {
  return {
    id: 'req-1',
    spaId: 'spa-1',
    serviceId: 'service-1',
    customerId: null,
    status: 'AWAITING_PAYMENT',
    email: 'ana.prueba@example.com',
    submittedName: 'Ana Prueba',
    submittedPhone: '04141234567',
    nationalId: '12345678',
    startAt: new Date('2026-11-16T14:00:00.000Z'),
    endAt: new Date('2026-11-16T14:30:00.000Z'),
    expiresAt: new Date(Date.now() + 60_000),
    tokenVersion: 1,
    segments: [
      {
        serviceId: 'service-1',
        serviceName: 'Manos Sencillas',
        professionalId: 'pro-1',
        professionalName: 'Jenny G',
        start: '2026-11-16T14:00:00.000Z',
        end: '2026-11-16T14:30:00.000Z',
      },
    ],
    spa: { id: 'spa-1', name: 'Emi Nails', slug: 'emi-nails', timezone: 'America/Caracas' },
    service: { spaId: 'spa-1', name: 'Manos Sencillas' },
    customer: null,
    appointment: null,
    visitAppointments: [],
  };
}

function reviewRow() {
  return {
    ...openRequest(),
    service: { name: 'Manos Sencillas' },
    paymentMethod: { type: 'PAGO_MOVIL' },
    paymentMethodLabel: 'Pago móvil de Emi',
    depositAmount: decimal('7.50'),
    depositCurrency: 'USD',
    depositVesAmount: decimal('6837.18'),
    exchangeRate: decimal('911.6243'),
    exchangeSource: 'BCV',
    exchangeQuotedAt: new Date('2026-11-13T04:00:00.000Z'),
    paymentReference: '123456',
    paymentSenderDetails: {
      nationalId: '12345678',
      phone: '04141234567',
      bank: '0134 - Banesco',
    },
    paymentProofPath: 'spa-1/req-1/file.jpg',
    paymentSubmittedAt: new Date('2026-11-15T20:00:00.000Z'),
  };
}

function decimal(value: string) {
  return { toString: () => value };
}
