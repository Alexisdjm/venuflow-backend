import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProfessionalsService } from './professionals.service';

jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('hash') }));

describe('ProfessionalsService', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => jest.clearAllMocks());

  it('filters reads by id and spaId and hides cross-tenant records', async () => {
    const prisma = {
      professional: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new ProfessionalsService(prisma as never, audit as never);
    await expect(service.get('spa-a', 'record-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.professional.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_spaId: { id: 'record-b', spaId: 'spa-a' } },
      }),
    );
  });

  it('lists professionals with tenant pagination', async () => {
    const prisma = {
      professional: {
        findMany: jest.fn().mockReturnValue('find-query'),
        count: jest.fn().mockReturnValue('count-query'),
      },
      $transaction: jest.fn().mockResolvedValue([[{ id: 'pro' }], 7]),
    };
    const service = new ProfessionalsService(prisma as never, audit as never);

    const result = await service.list('spa', { page: 2, limit: 5 });

    expect(prisma.professional.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaId: 'spa' }, skip: 5, take: 5 }),
    );
    expect(result.meta.total).toBe(7);
  });

  it('rejects a missing own professional profile', async () => {
    const prisma = {
      professional: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ProfessionalsService(prisma as never, audit as never);

    await expect(service.own('spa', 'user')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates and audits a professional atomically', async () => {
    const tx = {
      user: { create: jest.fn().mockResolvedValue({ id: 'user' }) },
      professional: {
        create: jest.fn().mockResolvedValue({ id: 'pro', userId: 'user' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new ProfessionalsService(prisma as never, audit as never);

    await service.create('spa', 'actor', {
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ANA@EXAMPLE.COM',
      password: 'password1234',
      displayName: 'Ana',
      commissionRate: '25',
    });

    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'ana@example.com' }),
      }),
    );
    expect(tx.professional.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ spaId: 'spa' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROFESSIONAL_CREATED' }),
    );
  });

  it('rejects commission rates outside zero to one hundred', async () => {
    const tx = {
      user: { create: jest.fn().mockResolvedValue({ id: 'user' }) },
      professional: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new ProfessionalsService(prisma as never, audit as never);

    await expect(
      service.create('spa', 'actor', {
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@example.com',
        password: 'password1234',
        displayName: 'Ana',
        commissionRate: '101',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents duplicate professional profiles for an administrator', async () => {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'admin' }) },
      professional: { findUnique: jest.fn().mockResolvedValue({ id: 'pro' }) },
    };
    const service = new ProfessionalsService(prisma as never, audit as never);

    await expect(
      service.createForAdmin('spa', 'admin', {
        displayName: 'Admin',
        commissionRate: '20',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a professional profile for the spa administrator', async () => {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'admin' }) },
      professional: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'pro' }),
      },
    };
    const service = new ProfessionalsService(prisma as never, audit as never);

    await service.createForAdmin('spa', 'admin', {
      displayName: 'Admin',
      commissionRate: '20',
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SPA_ADMIN_PROFESSIONAL_PROFILE_CREATED',
      }),
    );
  });

  it('updates professional and linked user status', async () => {
    const current = {
      id: 'pro',
      userId: 'user',
      user: { role: 'PROFESSIONAL' },
    };
    const tx = {
      user: { update: jest.fn() },
      professional: { update: jest.fn().mockResolvedValue({ id: 'pro' }) },
    };
    const prisma = {
      professional: { findUnique: jest.fn().mockResolvedValue(current) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const service = new ProfessionalsService(prisma as never, audit as never);

    await service.update('spa', 'actor', 'pro', {
      isActive: false,
      commissionRate: '30',
    });

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SUSPENDED' } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROFESSIONAL_UPDATED' }),
    );
  });
});
