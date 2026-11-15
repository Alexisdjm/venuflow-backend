import { BookingPaymentMaintenance } from './booking-payment-maintenance';

describe('payment hold maintenance', () => {
  const mail = { sendBookingPaymentExpired: jest.fn().mockResolvedValue(undefined) };
  const proofs = { remove: jest.fn().mockResolvedValue(undefined) };

  function service(rows: unknown[]) {
    const prisma = {
      bookingRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(rows)
          .mockResolvedValueOnce([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    return {
      prisma,
      maintenance: new BookingPaymentMaintenance(prisma as never, mail as never, proofs as never),
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('frees an expired hold, deletes the screenshot and emails the client once', async () => {
    const { prisma, maintenance } = service([
      {
        id: 'req-1',
        email: 'ana.prueba@example.com',
        submittedName: 'Ana Prueba',
        startAt: new Date('2026-11-16T14:00:00.000Z'),
        paymentProofPath: 'spa-1/req-1/file.jpg',
        spa: { name: 'Emi Nails', timezone: 'America/Caracas' },
        service: { name: 'Manos Sencillas' },
        professional: { displayName: 'Jenny G' },
      },
    ]);

    await maintenance.release('spa-1');

    expect(prisma.bookingRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXPIRED' } }),
    );
    expect(proofs.remove).toHaveBeenCalledWith('spa-1/req-1/file.jpg');
    expect(mail.sendBookingPaymentExpired).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ana.prueba@example.com',
        serviceName: 'Manos Sencillas',
        professionalName: 'Jenny G',
      }),
    );
  });

  it('does not email when another process already expired the hold', async () => {
    const { prisma, maintenance } = service([
      {
        id: 'req-1',
        email: 'ana.prueba@example.com',
        submittedName: 'Ana Prueba',
        startAt: new Date('2026-11-16T14:00:00.000Z'),
        paymentProofPath: null,
        spa: { name: 'Emi Nails', timezone: 'America/Caracas' },
        service: { name: 'Manos Sencillas' },
        professional: null,
      },
    ]);
    prisma.bookingRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    await maintenance.release('spa-1');

    expect(mail.sendBookingPaymentExpired).not.toHaveBeenCalled();
  });
});
