import { BadRequestException } from '@nestjs/common';
import { ServicesService } from './services.service';

describe('ServicesService', () => {
  const audit = { record: jest.fn() };

  it('rejects a service longer than the spa operating window', async () => {
    const prisma = {
      spa: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          openingMinute: 540,
          closingMinute: 1020,
        }),
      },
      spaService: { create: jest.fn() },
    };
    const service = new ServicesService(prisma as never, audit as never);

    await expect(
      service.create('spa', 'user', {
        name: 'Servicio demasiado largo',
        durationMinutes: 510,
        price: '10',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.spaService.create).not.toHaveBeenCalled();
  });

  it('allows a service that fits exactly inside the operating window', async () => {
    const prisma = {
      spa: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          openingMinute: 540,
          closingMinute: 1020,
        }),
      },
      spaService: {
        create: jest.fn().mockResolvedValue({ id: 'service' }),
      },
    };
    const service = new ServicesService(prisma as never, audit as never);

    await service.create('spa', 'user', {
      name: 'Jornada completa',
      durationMinutes: 480,
      price: '10',
    });
    expect(prisma.spaService.create).toHaveBeenCalled();
  });
});
