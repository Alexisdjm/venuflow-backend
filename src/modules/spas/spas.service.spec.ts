import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { SpasService } from './spas.service';

jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('hash') }));

describe('SpasService', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => jest.clearAllMocks());

  it('creates and audits a spa', async () => {
    const tx = {
      spa: { create: jest.fn().mockResolvedValue({ id: 'spa-1' }) },
      serviceCategory: { createMany: jest.fn().mockResolvedValue({ count: 5 }) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const service = new SpasService(prisma as never, audit as never);

    await service.create('actor-1', { name: 'Venue', slug: 'venue' } as never);

    expect(tx.serviceCategory.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ spaId: 'spa-1', name: 'Uñas' }),
          expect.objectContaining({ name: 'Maquillaje' }),
        ]),
      }),
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SPA_CREATED', spaId: 'spa-1' }),
    );
  });

  it('returns a paginated spa list', async () => {
    const prisma = {
      spa: {
        findMany: jest.fn().mockReturnValue('find-query'),
        count: jest.fn().mockReturnValue('count-query'),
      },
      $transaction: jest.fn().mockResolvedValue([[{ id: 'spa-1' }], 6]),
    };
    const service = new SpasService(prisma as never, audit as never);

    const result = await service.list({ page: 2, limit: 5 });

    expect(prisma.spa.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    );
    expect(result.meta.total).toBe(6);
  });

  it('rejects an unknown spa', async () => {
    const prisma = { spa: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new SpasService(prisma as never, audit as never);

    await expect(service.get('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects reversed operating hours', async () => {
    const service = new SpasService({} as never, audit as never);
    await expect(
      service.updateOperatingHours('actor', 'spa', 1080, 540),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents reducing hours around an existing schedule', async () => {
    const prisma = {
      professionalSchedule: {
        findFirst: jest.fn().mockResolvedValue({ id: 'schedule-1' }),
      },
    };
    const service = new SpasService(prisma as never, audit as never);

    await expect(
      service.updateOperatingHours('actor', 'spa', 600, 900),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents reducing hours below an active service duration', async () => {
    const prisma = {
      professionalSchedule: { findFirst: jest.fn().mockResolvedValue(null) },
      spaService: { findFirst: jest.fn().mockResolvedValue({ id: 'long' }) },
    };
    const service = new SpasService(prisma as never, audit as never);

    await expect(
      service.updateOperatingHours('actor', 'spa', 600, 900),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates valid operating hours and records the change', async () => {
    const updated = { id: 'spa', openingMinute: 540, closingMinute: 1080 };
    const prisma = {
      professionalSchedule: { findFirst: jest.fn().mockResolvedValue(null) },
      spaService: { findFirst: jest.fn().mockResolvedValue(null) },
      spa: { update: jest.fn().mockResolvedValue(updated) },
    };
    const service = new SpasService(prisma as never, audit as never);

    await expect(
      service.updateOperatingHours('actor', 'spa', 540, 1080, 5),
    ).resolves.toEqual(updated);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SPA_OPERATING_HOURS_UPDATED' }),
    );
    expect(prisma.spa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ walkInGraceMinutes: 5 }),
      }),
    );
  });

  it('prevents provisioning a second spa administrator', async () => {
    const prisma = {
      spa: { findUnique: jest.fn().mockResolvedValue({ id: 'spa' }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'admin' }) },
    };
    const service = new SpasService(prisma as never, audit as never);

    await expect(
      service.provisionAdmin('actor', 'spa', {} as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('provisions an administrator with a normalized email and hashed password', async () => {
    const prisma = {
      spa: { findUnique: jest.fn().mockResolvedValue({ id: 'spa' }) },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'admin', spaId: 'spa' }),
      },
    };
    const service = new SpasService(prisma as never, audit as never);

    await service.provisionAdmin('actor', 'spa', {
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ANA@EXAMPLE.COM',
      password: 'secure-password',
    });

    expect(argon2.hash).toHaveBeenCalledWith('secure-password');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'ana@example.com',
          passwordHash: 'hash',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SPA_ADMIN_PROVISIONED' }),
    );
  });
});
