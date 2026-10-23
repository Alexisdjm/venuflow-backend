import { ServiceUnavailableException } from '@nestjs/common';
import type { AuthUser } from '../common/auth.types';
import { AppointmentsController } from './appointments/appointments.controller';
import { RevenueController } from './appointments/revenue.controller';
import {
  PlatformAuditController,
  SpaAuditController,
} from './audit/audit.controller';
import { AuthController } from './auth/auth.controller';
import { AvailabilityController } from './availability/availability.controller';
import { CustomersController } from './customers/customers.controller';
import { HealthController } from './health/health.controller';
import {
  MySchedulesController,
  SchedulesController,
} from './schedules/schedules.controller';
import {
  MyServicesController,
  ServicesController,
} from './services/services.controller';
import { PlatformSpasController } from './spas/platform-spas.controller';
import { SpaAdminController } from './spas/spa-admin.controller';
import { MeController } from './users/me.controller';

const admin = {
  sub: 'user-1',
  spaId: 'spa-1',
  role: 'SPA_ADMIN',
  email: 'admin@example.com',
} as AuthUser;

describe('HTTP controllers', () => {
  it('delegates appointment operations with the authenticated user', async () => {
    const service = {
      list: jest.fn().mockResolvedValue('list'),
      create: jest.fn().mockResolvedValue('create'),
      update: jest.fn().mockResolvedValue('update'),
    };
    const controller = new AppointmentsController(service as never);
    const createDto = { serviceId: 'service' } as never;
    const updateDto = { status: 'CANCELLED' } as never;

    await expect(
      controller.list(admin, { date: '2026-10-23', status: 'SCHEDULED' }),
    ).resolves.toBe('list');
    await expect(controller.create(admin, createDto)).resolves.toBe('create');
    await expect(
      controller.update(admin, 'appointment', updateDto),
    ).resolves.toBe('update');
    expect(service.list).toHaveBeenCalledWith(admin, '2026-10-23', 'SCHEDULED');
    expect(service.create).toHaveBeenCalledWith(admin, createDto);
    expect(service.update).toHaveBeenCalledWith(
      admin,
      'appointment',
      updateDto,
    );
  });

  it('delegates revenue using the user tenant', async () => {
    const revenue = { get: jest.fn().mockResolvedValue('report') };
    const controller = new RevenueController(revenue as never);
    const query = { period: 'month' } as never;

    await expect(controller.get(admin, query)).resolves.toBe('report');
    expect(revenue.get).toHaveBeenCalledWith('spa-1', query);
  });

  it('scopes spa audit logs and leaves platform logs unscoped', async () => {
    const audit = { list: jest.fn().mockResolvedValue('logs') };
    const query = { page: 1, limit: 20 };

    await new PlatformAuditController(audit as never).list(query);
    await new SpaAuditController(audit as never).list(admin, query);

    expect(audit.list).toHaveBeenNthCalledWith(1, undefined, query);
    expect(audit.list).toHaveBeenNthCalledWith(2, 'spa-1', query);
  });

  it('delegates every authentication operation', async () => {
    const auth = {
      login: jest.fn().mockResolvedValue('login'),
      refresh: jest.fn().mockResolvedValue('refresh'),
      logout: jest.fn().mockResolvedValue('logout'),
      me: jest.fn().mockResolvedValue('me'),
    };
    const controller = new AuthController(auth as never);

    await controller.login({ email: 'a@b.com', password: 'password1234' });
    await controller.refresh({ refreshToken: 'refresh-token' });
    await controller.logout({ refreshToken: 'refresh-token' });
    await controller.me(admin);

    expect(auth.login).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'password1234',
    });
    expect(auth.refresh).toHaveBeenCalledWith('refresh-token');
    expect(auth.logout).toHaveBeenCalledWith('refresh-token');
    expect(auth.me).toHaveBeenCalledWith('user-1');
  });

  it('forces a professional availability query to their own profile', async () => {
    const availability = { get: jest.fn().mockResolvedValue('slots') };
    const prisma = {
      professional: {
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'pro-1' }),
      },
    };
    const controller = new AvailabilityController(
      availability as never,
      prisma as never,
    );
    const user = { ...admin, role: 'PROFESSIONAL' } as AuthUser;
    const query = { date: '2026-10-23' } as never;

    await controller.get(user, query);

    expect(prisma.professional.findFirstOrThrow).toHaveBeenCalledWith({
      where: { spaId: 'spa-1', userId: 'user-1' },
    });
    expect(availability.get).toHaveBeenCalledWith(
      'spa-1',
      expect.objectContaining({ professionalId: 'pro-1' }),
    );
  });

  it('preserves an admin availability query', async () => {
    const availability = { get: jest.fn().mockResolvedValue('slots') };
    const prisma = { professional: { findFirstOrThrow: jest.fn() } };
    const controller = new AvailabilityController(
      availability as never,
      prisma as never,
    );
    const query = { date: '2026-10-23', professionalId: 'pro-2' } as never;

    await controller.get(admin, query);

    expect(prisma.professional.findFirstOrThrow).not.toHaveBeenCalled();
    expect(availability.get).toHaveBeenCalledWith('spa-1', query);
  });

  it('delegates customer operations within the user tenant', async () => {
    const customers = {
      list: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    const controller = new CustomersController(customers as never);
    const query = { page: 1, limit: 10 } as never;
    const dto = { firstName: 'Ana' } as never;

    controller.list(admin, query);
    controller.get(admin, 'customer');
    controller.update(admin, 'customer', dto);
    controller.remove(admin, 'customer');

    expect(customers.list).toHaveBeenCalledWith('spa-1', query);
    expect(customers.get).toHaveBeenCalledWith('spa-1', 'customer');
    expect(customers.update).toHaveBeenCalledWith(
      'spa-1',
      'user-1',
      'customer',
      dto,
    );
    expect(customers.remove).toHaveBeenCalledWith(
      'spa-1',
      'user-1',
      'customer',
    );
  });

  it('reports healthy and unavailable database states', async () => {
    const healthy = { $queryRaw: jest.fn().mockResolvedValue([{ value: 1 }]) };
    await expect(
      new HealthController(healthy as never).health(),
    ).resolves.toMatchObject({ status: 'ok' });

    const failing = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('down')),
    };
    await expect(
      new HealthController(failing as never).health(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('delegates schedule operations with tenant and actor identifiers', () => {
    const schedules = {
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      listOwn: jest.fn(),
    };
    const controller = new SchedulesController(schedules as never);
    const createDto = { dayOfWeek: 1 } as never;
    const updateDto = { isActive: false } as never;

    controller.list(admin, 'pro');
    controller.create(admin, 'pro', createDto);
    controller.update(admin, 'schedule', updateDto);
    controller.remove(admin, 'pro', 'schedule');
    new MySchedulesController(schedules as never).list(admin);

    expect(schedules.list).toHaveBeenCalledWith('spa-1', 'pro');
    expect(schedules.create).toHaveBeenCalledWith(
      'spa-1',
      'user-1',
      'pro',
      createDto,
    );
    expect(schedules.update).toHaveBeenCalledWith(
      'spa-1',
      'user-1',
      'schedule',
      updateDto,
    );
    expect(schedules.remove).toHaveBeenCalledWith(
      'spa-1',
      'user-1',
      'pro',
      'schedule',
    );
    expect(schedules.listOwn).toHaveBeenCalledWith('spa-1', 'user-1');
  });

  it('delegates service operations and professional assignments', () => {
    const services = {
      list: jest.fn(),
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      assign: jest.fn(),
      unassign: jest.fn(),
      listOwn: jest.fn(),
    };
    const controller = new ServicesController(services as never);
    const query = { page: 1, limit: 10 };
    const createDto = { name: 'Corte' } as never;
    const updateDto = { name: 'Color' } as never;

    controller.list(admin, query);
    controller.create(admin, createDto);
    controller.get(admin, 'service');
    controller.update(admin, 'service', updateDto);
    controller.assign(admin, 'service', 'pro');
    controller.unassign(admin, 'service', 'pro');
    new MyServicesController(services as never).list(admin);

    expect(services.list).toHaveBeenCalledWith('spa-1', query);
    expect(services.create).toHaveBeenCalledWith('spa-1', 'user-1', createDto);
    expect(services.get).toHaveBeenCalledWith('spa-1', 'service');
    expect(services.update).toHaveBeenCalledWith(
      'spa-1',
      'user-1',
      'service',
      updateDto,
    );
    expect(services.assign).toHaveBeenCalledWith(
      'spa-1',
      'user-1',
      'pro',
      'service',
    );
    expect(services.unassign).toHaveBeenCalledWith(
      'spa-1',
      'user-1',
      'pro',
      'service',
    );
    expect(services.listOwn).toHaveBeenCalledWith('spa-1', 'user-1');
  });

  it('delegates platform spa administration', () => {
    const spas = {
      create: jest.fn(),
      list: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      provisionAdmin: jest.fn(),
    };
    const controller = new PlatformSpasController(spas as never);
    const query = { page: 1, limit: 10 };
    const createDto = { name: 'Spa' } as never;
    const updateDto = { status: 'ACTIVE' } as never;
    const provisionDto = { email: 'admin@example.com' } as never;

    controller.create(admin, createDto);
    controller.list(query);
    controller.get('spa-2');
    controller.update(admin, 'spa-2', updateDto);
    controller.admin(admin, 'spa-2', provisionDto);

    expect(spas.create).toHaveBeenCalledWith('user-1', createDto);
    expect(spas.list).toHaveBeenCalledWith(query);
    expect(spas.get).toHaveBeenCalledWith('spa-2');
    expect(spas.update).toHaveBeenCalledWith('user-1', 'spa-2', updateDto);
    expect(spas.provisionAdmin).toHaveBeenCalledWith(
      'user-1',
      'spa-2',
      provisionDto,
    );
  });

  it('delegates all spa admin operations and enforces a tenant', async () => {
    const prisma = { spa: { findUniqueOrThrow: jest.fn() } };
    const users = { list: jest.fn() };
    const professionals = {
      list: jest.fn(),
      create: jest.fn(),
      createForAdmin: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
    };
    const services = { listForProfessional: jest.fn() };
    const spas = { updateOperatingHours: jest.fn() };
    const controller = new SpaAdminController(
      prisma as never,
      users as never,
      professionals as never,
      services as never,
      spas as never,
    );
    const query = { page: 1, limit: 10 };

    controller.getSpa(admin);
    controller.updateOperatingHours(admin, {
      openingMinute: 540,
      closingMinute: 1080,
    });
    controller.listUsers(admin, query);
    controller.list(admin, query);
    controller.create(admin, {} as never);
    controller.createOwnProfessionalProfile(admin, {} as never);
    controller.get(admin, 'pro');
    controller.update(admin, 'pro', {} as never);
    controller.servicesForProfessional(admin, 'pro');

    expect(prisma.spa.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'spa-1' },
    });
    expect(spas.updateOperatingHours).toHaveBeenCalledWith(
      'user-1',
      'spa-1',
      540,
      1080,
    );
    expect(users.list).toHaveBeenCalledWith('spa-1', query);
    expect(professionals.createForAdmin).toHaveBeenCalledWith(
      'spa-1',
      'user-1',
      {},
    );
    expect(services.listForProfessional).toHaveBeenCalledWith('spa-1', 'pro');

    expect(() => controller.getSpa({ ...admin, spaId: null })).toThrow(
      'Missing tenant',
    );
  });

  it('returns a professional profile only for professional users', async () => {
    const auth = { me: jest.fn().mockResolvedValue({ id: 'user-1' }) };
    const professionals = { own: jest.fn().mockResolvedValue({ id: 'pro-1' }) };
    const controller = new MeController(auth as never, professionals as never);

    await expect(controller.me(admin)).resolves.toEqual({
      id: 'user-1',
      professional: null,
    });
    await expect(
      controller.me({ ...admin, role: 'PROFESSIONAL' } as AuthUser),
    ).resolves.toEqual({ id: 'user-1', professional: { id: 'pro-1' } });
    expect(professionals.own).toHaveBeenCalledWith('spa-1', 'user-1');
  });
});
