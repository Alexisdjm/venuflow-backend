import { BadRequestException } from '@nestjs/common';
import { RevenueService } from './revenue.service';

describe('RevenueService', () => {
  const spa = { timezone: 'America/Caracas', currency: 'USD' };

  it('rejects an invalid reference date', async () => {
    const prisma = {
      spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
    };
    const service = new RevenueService(prisma as never);

    await expect(
      service.get('spa-1', { date: 'not-a-date', period: 'day' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aggregates completed appointments by professional and service', async () => {
    const prisma = {
      spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
      appointment: {
        findMany: jest.fn().mockResolvedValue([
          {
            professionalId: 'pro-1',
            serviceId: 'service-1',
            servicePrice: '100',
            commissionRate: '20',
            startAt: new Date('2026-10-23T14:00:00.000Z'),
            professional: { id: 'pro-1', displayName: 'Ana' },
            service: { id: 'service-1', name: 'Color' },
          },
          {
            professionalId: 'pro-1',
            serviceId: 'service-1',
            servicePrice: '50',
            commissionRate: '10',
            startAt: new Date('2026-10-23T15:00:00.000Z'),
            professional: { id: 'pro-1', displayName: 'Ana' },
            service: { id: 'service-1', name: 'Color' },
          },
        ]),
      },
    };
    const service = new RevenueService(prisma as never);

    const result = await service.get('spa-1', {
      date: '2026-10-23',
      period: 'day',
    });

    expect(result.totals).toEqual({
      gross: 150,
      commissions: 25,
      net: 125,
      appointments: 2,
    });
    expect(result.professionals[0]).toMatchObject({
      professionalId: 'pro-1',
      gross: 150,
      commission: 25,
      appointments: 2,
    });
    expect(result.professionals[0].services[0]).toMatchObject({
      serviceId: 'service-1',
      gross: 150,
      commission: 25,
      appointments: 2,
    });
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ spaId: 'spa-1', status: 'COMPLETED' }),
      }),
    );
  });

  it.each(['week', 'month'] as const)(
    'builds a %s reporting range',
    async (period) => {
      const prisma = {
        spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
        appointment: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new RevenueService(prisma as never);

      const result = await service.get('spa-1', {
        date: '2026-10-23',
        period,
      });

      expect(result.period).toBe(period);
      expect(result.totals.appointments).toBe(0);
    },
  );
});
