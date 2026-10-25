import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ServicesService } from './services.service';

describe('ServicesService', () => {
  const audit = { record: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

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
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'category-id' }),
      },
    };
    const service = new ServicesService(prisma as never, audit as never);

    await service.create('spa', 'user', {
      name: 'Jornada completa',
      categoryId: 'category-id',
      durationMinutes: 480,
      price: '10',
    });
    expect(prisma.spaService.create).toHaveBeenCalled();
  });

  it('requires a duration for fixed services', async () => {
    const service = new ServicesService({} as never, audit as never);
    await expect(
      service.create('spa', 'user', {
        name: 'Corte',
        price: '10',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a variable-duration service without fixed minutes', async () => {
    const prisma = {
      spaService: { create: jest.fn().mockResolvedValue({ id: 'service' }) },
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'category-id' }),
      },
    };
    const service = new ServicesService(prisma as never, audit as never);

    await service.create('spa', 'user', {
      name: 'Colorimetría',
      categoryId: 'category-id',
      durationType: 'VARIABLE',
      priceType: 'VARIABLE',
      price: '20',
    });

    expect(prisma.spaService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationMinutes: null }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SERVICE_CREATED' }),
    );
  });

  it('lists and gets services within the spa tenant', async () => {
    const prisma = {
      spaService: {
        findMany: jest.fn().mockReturnValue('find-query'),
        count: jest.fn().mockReturnValue('count-query'),
        findUnique: jest.fn().mockResolvedValue({ id: 'service' }),
      },
      $transaction: jest.fn().mockResolvedValue([[{ id: 'service' }], 1]),
    };
    const service = new ServicesService(prisma as never, audit as never);

    const result = await service.list('spa', { page: 1, limit: 10 });
    await expect(service.get('spa', 'service')).resolves.toEqual({
      id: 'service',
    });

    expect(result.meta.total).toBe(1);
    expect(prisma.spaService.findUnique).toHaveBeenCalledWith({
      where: { id_spaId: { id: 'service', spaId: 'spa' } },
      include: { category: { select: { id: true, name: true } } },
    });
  });

  it('rejects an unknown service', async () => {
    const prisma = {
      spaService: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new ServicesService(prisma as never, audit as never);
    await expect(service.get('spa', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates a fixed service and audits the change', async () => {
    const prisma = {
      spa: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          openingMinute: 540,
          closingMinute: 1080,
        }),
      },
      spaService: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'service',
          durationType: 'VARIABLE',
          durationMinutes: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'service' }),
      },
    };
    const service = new ServicesService(prisma as never, audit as never);

    await service.update('spa', 'actor', 'service', {
      durationType: 'FIXED',
      durationMinutes: 60,
      price: '25',
    });

    expect(prisma.spaService.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationMinutes: 60 }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SERVICE_UPDATED' }),
    );
  });

  it('assigns and unassigns a service from a professional', async () => {
    const prisma = {
      professional: { findUnique: jest.fn().mockResolvedValue({ id: 'pro' }) },
      spaService: {
        findUnique: jest.fn().mockResolvedValue({ id: 'service' }),
      },
      professionalService: {
        upsert: jest.fn().mockResolvedValue({ id: 'assignment' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'assignment' }),
        delete: jest.fn().mockResolvedValue({ id: 'assignment' }),
      },
    };
    const service = new ServicesService(prisma as never, audit as never);

    await expect(
      service.assign('spa', 'actor', 'pro', 'service'),
    ).resolves.toEqual({ id: 'assignment' });
    await expect(
      service.unassign('spa', 'actor', 'pro', 'service'),
    ).resolves.toEqual({ success: true });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SERVICE_ASSIGNED' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SERVICE_UNASSIGNED' }),
    );
  });

  it('rejects invalid assignments and resolves own services', async () => {
    const prisma = {
      professional: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue({ id: 'pro' }),
      },
      spaService: {
        findUnique: jest.fn().mockResolvedValue({ id: 'service' }),
      },
      professionalService: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ServicesService(prisma as never, audit as never);

    await expect(
      service.assign('spa', 'actor', 'missing', 'service'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listOwn('spa', 'user')).resolves.toEqual([]);
    expect(prisma.professionalService.findMany).toHaveBeenCalledWith({
      where: { spaId: 'spa', professionalId: 'pro' },
      include: {
        service: { include: { category: { select: { id: true, name: true } } } },
      },
    });
  });
});
