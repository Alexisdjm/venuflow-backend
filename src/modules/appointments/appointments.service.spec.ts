import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { Prisma } from '../../generated/prisma/client';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsService', () => {
  const admin = {
    sub: 'user-id',
    spaId: 'spa-id',
    role: 'SPA_ADMIN',
    email: 'admin@test.com',
  } as const;
  const fixedService = {
    id: 'service-id',
    isActive: true,
    durationType: 'FIXED',
    durationMinutes: 60,
    priceType: 'FIXED',
    price: new Prisma.Decimal(25),
  };
  const spa = {
    timezone: 'UTC',
    openingMinute: 540,
    closingMinute: 1080,
  };
  const future = () =>
    DateTime.utc().plus({ days: 2 }).startOf('day').plus({ hours: 10 }).toISO();
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => jest.clearAllMocks());

  it('rejects inactive or missing services', async () => {
    const prisma = {
      spaService: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.create(admin, { serviceId: 'missing', startAt: future()! }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires a selected duration for variable services', async () => {
    const prisma = {
      spaService: {
        findUnique: jest.fn().mockResolvedValue({
          ...fixedService,
          durationType: 'VARIABLE',
          durationMinutes: null,
        }),
      },
      spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.create(admin, { serviceId: 'service-id', startAt: future()! }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects appointments outside operating hours', async () => {
    const prisma = {
      spaService: { findUnique: jest.fn().mockResolvedValue(fixedService) },
      spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
    };
    const service = new AppointmentsService(prisma as never, audit as never);
    const startAt = DateTime.utc()
      .plus({ days: 2 })
      .startOf('day')
      .plus({ hours: 17, minutes: 30 })
      .toISO()!;

    await expect(
      service.create(admin, { serviceId: 'service-id', startAt }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates an appointment with financial snapshots and an audit event', async () => {
    const appointment = { id: 'appointment-id' };
    const prisma = {
      spaService: { findUnique: jest.fn().mockResolvedValue(fixedService) },
      spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
      professionalService: {
        findMany: jest.fn().mockResolvedValue([{ professionalId: 'pro-id' }]),
        findFirst: jest.fn().mockResolvedValue({
          professional: { commissionRate: new Prisma.Decimal(40) },
        }),
      },
      professionalSchedule: {
        findFirst: jest.fn().mockResolvedValue({ id: 'schedule-id' }),
      },
      customer: {
        create: jest.fn().mockResolvedValue({
          id: 'customer-id',
          name: 'Ana Pérez',
          nationalId: '12345678',
          phone: '04120000000',
          email: null,
        }),
      },
      appointment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(appointment),
      },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.create(admin, {
        serviceId: 'service-id',
        startAt: future()!,
        customerName: 'Ana Pérez',
        customerNationalId: '12345678',
        customerPhone: '04120000000',
      }),
    ).resolves.toEqual(appointment);
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          servicePrice: fixedService.price,
          professionalId: 'pro-id',
          customerId: 'customer-id',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPOINTMENT_CREATED' }),
    );
  });

  it('reports no availability when no assigned professional has a schedule', async () => {
    const prisma = {
      spaService: { findUnique: jest.fn().mockResolvedValue(fixedService) },
      spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
      professionalService: {
        findMany: jest.fn().mockResolvedValue([{ professionalId: 'pro-id' }]),
        findFirst: jest.fn().mockResolvedValue({
          professional: { commissionRate: new Prisma.Decimal(40) },
        }),
      },
      professionalSchedule: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.create(admin, {
        serviceId: 'service-id',
        startAt: future()!,
        customerName: 'Ana Pérez',
        customerNationalId: '12345678',
        customerPhone: '04120000000',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents changing completed or cancelled appointments', async () => {
    const prisma = {
      appointment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'appointment-id',
          status: 'COMPLETED',
          service: fixedService,
        }),
      },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.update(admin, 'appointment-id', { status: 'CANCELLED' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents completing an appointment before its end time', async () => {
    const prisma = {
      appointment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'appointment-id',
          status: 'CONFIRMED',
          startAt: new Date(Date.now() + 30_000),
          endAt: new Date(Date.now() + 3_600_000),
          service: fixedService,
        }),
      },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.update(admin, 'appointment-id', { status: 'COMPLETED' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('completes an appointment only after its end and records the change', async () => {
    const current = {
      id: 'appointment-id',
      status: 'CONFIRMED',
      startAt: new Date(Date.now() - 7_200_000),
      endAt: new Date(Date.now() - 3_600_000),
      professionalId: 'pro-id',
      serviceId: 'service-id',
      service: fixedService,
    };
    const prisma = {
      appointment: {
        findFirst: jest.fn().mockResolvedValue(current),
        update: jest
          .fn()
          .mockResolvedValue({ ...current, status: 'COMPLETED' }),
      },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.update(admin, current.id, { status: 'COMPLETED' }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPOINTMENT_UPDATED' }),
    );
  });

  it('requires an actual change when updating an appointment', async () => {
    const prisma = {
      appointment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'appointment-id',
          status: 'CONFIRMED',
          service: fixedService,
        }),
      },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.update(admin, 'appointment-id', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revalidates operating hours, schedule and conflicts when rescheduling', async () => {
    const currentStart = DateTime.utc()
      .plus({ days: 1 })
      .startOf('day')
      .plus({ hours: 10 });
    const current = {
      id: 'appointment-id',
      status: 'CONFIRMED',
      startAt: currentStart.toJSDate(),
      endAt: currentStart.plus({ hours: 1 }).toJSDate(),
      professionalId: 'pro-id',
      serviceId: 'service-id',
      service: fixedService,
    };
    const nextStart = currentStart.plus({ days: 1 }).toISO()!;
    const prisma = {
      appointment: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValue({ ...current, startAt: nextStart }),
      },
      spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
      professionalService: {
        findFirst: jest.fn().mockResolvedValue({
          professional: { commissionRate: new Prisma.Decimal(35) },
        }),
      },
      professionalSchedule: {
        findFirst: jest.fn().mockResolvedValue({ id: 'schedule-id' }),
      },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.update(admin, current.id, { startAt: nextStart }),
    ).resolves.toBeDefined();
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startAt: expect.any(Date),
          endAt: expect.any(Date),
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPOINTMENT_RESCHEDULED' }),
    );
  });

  it('prevents professionals from transferring their appointments', async () => {
    const professional = { ...admin, role: 'PROFESSIONAL' as const };
    const prisma = {
      professional: {
        findFirst: jest.fn().mockResolvedValue({ id: 'own-pro-id' }),
      },
      appointment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'appointment-id',
          status: 'CONFIRMED',
          professionalId: 'own-pro-id',
          service: fixedService,
        }),
      },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.update(professional, 'appointment-id', {
        professionalId: 'other-pro-id',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scopes professional appointment lists to their own profile', async () => {
    const prisma = {
      professional: {
        findFirst: jest.fn().mockResolvedValue({ id: 'own-pro-id' }),
      },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await service.list({ ...admin, role: 'PROFESSIONAL' });
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ professionalId: 'own-pro-id' }),
      }),
    );
  });
});
