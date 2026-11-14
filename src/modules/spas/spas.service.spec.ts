import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import * as argon2 from 'argon2';
import { monthlyPlanRevenue } from './spa-plan';
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

  it('rejects a reserved public slug', async () => {
    const service = new SpasService({} as never, audit as never);
    await expect(
      service.create('actor', { name: 'Api', slug: 'api' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  it('rejects an administrator update when the spa has none', async () => {
    const prisma = {
      spa: { findUnique: jest.fn().mockResolvedValue({ id: 'spa' }) },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new SpasService(prisma as never, audit as never);

    await expect(
      service.updateAdmin('actor', 'spa', {
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@example.com',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates the existing administrator and revokes sessions when access changes', async () => {
    const tx = {
      user: {
        update: jest.fn().mockResolvedValue({ id: 'admin', email: 'nueva@example.com' }),
      },
      session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      spa: { findUnique: jest.fn().mockResolvedValue({ id: 'spa', slug: 'demo' }) },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'admin',
          email: 'admin.spa.a@example.com',
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const service = new SpasService(prisma as never, audit as never);

    await service.updateAdmin('actor', 'spa', {
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'NUEVA@EXAMPLE.COM',
      password: 'otra-clave-larga',
    });

    expect(argon2.hash).toHaveBeenCalledWith('otra-clave-larga');
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'admin' },
        data: expect.objectContaining({
          email: 'nueva@example.com',
          passwordHash: 'hash',
        }),
      }),
    );
    expect(tx.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'admin', revokedAt: null } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SPA_ADMIN_UPDATED',
        metadata: { emailChanged: true, passwordChanged: true },
      }),
    );
  });

  it('keeps the password and open sessions when only the name changes', async () => {
    const tx = {
      user: { update: jest.fn().mockResolvedValue({ id: 'admin' }) },
      session: { updateMany: jest.fn() },
    };
    const prisma = {
      spa: { findUnique: jest.fn().mockResolvedValue({ id: 'spa', slug: 'demo' }) },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'admin',
          email: 'admin.spa.a@example.com',
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const service = new SpasService(prisma as never, audit as never);

    await service.updateAdmin('actor', 'spa', {
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'admin.spa.a@example.com',
    });

    expect(argon2.hash).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ passwordHash: expect.anything() }),
      }),
    );
    expect(tx.session.updateMany).not.toHaveBeenCalled();
  });

  it('summarizes platform access, monthly reservations and due dates once per spa', async () => {
    const now = DateTime.fromISO('2026-11-12T15:00:00', { zone: 'America/Caracas' });
    if (!now.isValid) throw new Error('Fecha de prueba inválida');
    const prisma = {
      spa: {
        findMany: jest.fn().mockResolvedValue([
          { ...spa('recent', null, '2026-11-10T00:00:00.000Z'), plan: 'BASIC' },
          spa('soon', 15, '2026-01-01T00:00:00.000Z'),
          spa('passed', 10, '2026-06-01T00:00:00.000Z', 'SUSPENDED'),
        ]),
      },
      appointment: { count: jest.fn().mockResolvedValue(4) },
    };
    const service = new SpasService(prisma as never, audit as never);

    const summary = await service.platformSummary(now);

    expect(prisma.appointment.count).toHaveBeenCalledTimes(1);
    expect(summary.registered).toEqual({ total: 3, active: 2, inactive: 1 });
    expect(summary.activeAccess).toBe(2);
    expect(summary.monthlyRevenue).toBe(120);
    expect(summary.upcomingDue).toBe(1);
    expect(summary.reservationsThisMonth).toBe(4);
    expect(summary.attention).toEqual({ dueReached: 1, unconfigured: 1, total: 2 });
    expect(summary.spas.map((item) => item.id)).toEqual(['soon', 'passed', 'recent']);
    expect(summary.spas[1]).toEqual(expect.objectContaining({ status: 'SUSPENDED', attention: 'reached' }));
  });

  it('keeps a free demo out of the monthly plan revenue', () => {
    expect(monthlyPlanRevenue(['DEMO', 'BASIC', 'PLUS', 'DEMO'])).toBe(75);
  });

  it('publishes the remote form for Plus and Demo spas', async () => {
    const config = {
      get: (key: string) =>
        ({
          PUBLIC_BOOKING_ROOT_DOMAIN: 'tryvenueflow.com',
          PUBLIC_BOOKING_PROTOCOL: 'https',
        })[key],
    };
    const prisma = {
      spa: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'plus', slug: 'plus-spa', plan: 'PLUS' })
          .mockResolvedValueOnce({ id: 'basic', slug: 'basic-spa', plan: 'BASIC' })
          .mockResolvedValueOnce({ id: 'demo', slug: 'demo-spa', plan: 'DEMO' }),
      },
    };
    const service = new SpasService(prisma as never, audit as never, config as never);

    await expect(service.get('plus')).resolves.toEqual(
      expect.objectContaining({ publicUrl: 'https://plus-spa.tryvenueflow.com' }),
    );
    await expect(service.get('basic')).resolves.toEqual(
      expect.objectContaining({ publicUrl: null }),
    );
    await expect(service.get('demo')).resolves.toEqual(
      expect.objectContaining({ publicUrl: 'https://demo-spa.tryvenueflow.com' }),
    );
  });
});

function spa(
  id: string,
  billingDueDay: number | null,
  createdAt: string,
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
) {
  return {
    id,
    name: id,
    slug: id,
    status,
    timezone: 'America/Caracas',
    plan: 'PLUS',
    billingDueDay,
    createdAt: new Date(createdAt),
  };
}
