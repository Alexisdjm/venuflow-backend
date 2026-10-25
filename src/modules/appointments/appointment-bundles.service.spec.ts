import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AppointmentBundlesService } from './appointment-bundles.service';

describe('AppointmentBundlesService', () => {
  const admin = {
    sub: 'admin',
    spaId: 'spa',
    role: 'SPA_ADMIN',
    email: 'admin@example.com',
  } as const;
  const service = (
    id: string,
    categoryId: string,
    durationMinutes: number,
  ) => ({
    id,
    spaId: 'spa',
    name: id,
    isActive: true,
    categoryId,
    category: { id: categoryId, name: categoryId },
    durationType: 'FIXED',
    durationMinutes,
    priceType: 'FIXED',
    price: new Prisma.Decimal(20),
  });

  it('builds consecutive segments with the requested professional per service', async () => {
    const services = [
      service('nails', 'cat-nails', 60),
      service('hair', 'cat-hair', 120),
    ];
    const prisma = {
      spaService: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(services[0])
          .mockResolvedValueOnce(services[1]),
      },
      spa: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          timezone: 'UTC',
          openingMinute: 540,
          closingMinute: 720,
          walkInGraceMinutes: 5,
        }),
      },
      professionalService: {
        findMany: jest.fn().mockResolvedValue([
          {
            serviceId: 'nails',
            professionalId: 'pro-nails',
            professional: {
              id: 'pro-nails',
              displayName: 'Ana',
              commissionRate: new Prisma.Decimal(20),
              schedules: [{ startMinute: 540, endMinute: 720 }],
            },
          },
          {
            serviceId: 'hair',
            professionalId: 'pro-hair',
            professional: {
              id: 'pro-hair',
              displayName: 'Luisa',
              commissionRate: new Prisma.Decimal(25),
              schedules: [{ startMinute: 540, endMinute: 720 }],
            },
          },
        ]),
      },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const bundles = new AppointmentBundlesService(prisma as never);

    const result = await bundles.availability(admin, {
      date: '2099-10-25',
      intervalMinutes: 30,
      items: [
        { serviceId: 'nails', professionalId: 'pro-nails' },
        { serviceId: 'hair', professionalId: 'pro-hair' },
      ],
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].segments).toMatchObject([
      {
        professionalId: 'pro-nails',
        start: '2099-10-25T09:00:00.000Z',
        end: '2099-10-25T10:00:00.000Z',
      },
      {
        professionalId: 'pro-hair',
        start: '2099-10-25T10:00:00.000Z',
        end: '2099-10-25T12:00:00.000Z',
      },
    ]);
  });

  it('rejects two services from the same category', async () => {
    const prisma = {
      spaService: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(service('one', 'same-category', 60))
          .mockResolvedValueOnce(service('two', 'same-category', 60)),
      },
    };
    const bundles = new AppointmentBundlesService(prisma as never);

    await expect(
      bundles.availability(admin, {
        date: '2099-10-25',
        intervalMinutes: 30,
        items: [{ serviceId: 'one' }, { serviceId: 'two' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
