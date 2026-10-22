import { AvailabilityService } from './availability.service';

describe('AvailabilityService', () => {
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
});
