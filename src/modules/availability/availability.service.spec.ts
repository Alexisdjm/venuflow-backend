import { AvailabilityService } from './availability.service';

describe('AvailabilityService', () => {
  afterEach(() => jest.useRealTimers());

  it('creates timezone-aware slots inside the weekly schedule', async () => {
    const prisma = {
      spa: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Caracas' }),
      },
      spaService: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'service',
          isActive: true,
          durationMinutes: 30,
        }),
      },
      professionalService: {
        findMany: jest.fn().mockResolvedValue([
          {
            professional: {
              id: 'professional',
              schedules: [{ startMinute: 540, endMinute: 600 }],
            },
          },
        ]),
      },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const result = await new AvailabilityService(prisma as never).get('spa', {
      date: '2099-10-20',
      serviceId: 'service',
      intervalMinutes: 15,
    });
    expect(result.data).toHaveLength(3);
    expect(result.data[0]).toMatchObject({
      start: '2099-10-20T13:00:00.000Z',
      localStart: '2099-10-20T09:00:00.000-04:00',
    });
    expect(prisma.professionalService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          professional: { isActive: true },
        }),
      }),
    );
  });

  it.each([undefined, 'professional-id'])(
    'filters inactive professionals with explicit filter %s',
    async (professionalId) => {
      const prisma = {
        spa: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
        },
        spaService: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'service',
            isActive: true,
            durationMinutes: 30,
          }),
        },
        professionalService: { findMany: jest.fn().mockResolvedValue([]) },
        appointment: { findMany: jest.fn().mockResolvedValue([]) },
      };
      await new AvailabilityService(prisma as never).get('spa', {
        date: '2099-10-20',
        serviceId: 'service',
        intervalMinutes: 30,
        professionalId,
      });
      expect(prisma.professionalService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            spaId: 'spa',
            serviceId: 'service',
            professionalId,
            professional: { isActive: true },
          },
        }),
      );
    },
  );

  it('returns and marks the preceding slot inside the grace period', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-24T17:02:00.000Z'));
    const prisma = {
      spa: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          timezone: 'UTC',
          openingMinute: 540,
          closingMinute: 1080,
          walkInGraceMinutes: 5,
        }),
      },
      spaService: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'service',
          isActive: true,
          durationType: 'FIXED',
          durationMinutes: 60,
        }),
      },
      professionalService: {
        findMany: jest.fn().mockResolvedValue([
          {
            professional: {
              id: 'professional',
              schedules: [{ startMinute: 1020, endMinute: 1080 }],
            },
          },
        ]),
      },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AvailabilityService(prisma as never);

    const result = await service.get('spa', {
      date: '2026-10-24',
      serviceId: 'service',
      intervalMinutes: 30,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      localStart: '2026-10-24T17:00:00.000Z',
      isGracePeriod: true,
    });
  });
});
