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
    categoryId: 'category-id',
  };
  const spa = {
    timezone: 'UTC',
    openingMinute: 540,
    closingMinute: 1080,
    walkInGraceMinutes: 5,
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

  it('automatically allows a recently started slot inside the grace period', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-24T17:02:00.000Z'));
    const appointment = { id: 'walk-in' };
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
        findUnique: jest.fn().mockResolvedValue({
          id: 'customer-id',
          name: 'Ana',
          phone: '04120000000',
          nationalId: '12345678',
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
        customerId: 'customer-id',
        startAt: '2026-10-24T17:00:00.000Z',
      }),
    ).resolves.toEqual({ ...appointment, customerStatus: 'recurring' });
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isWalkIn: true }),
      }),
    );
    jest.useRealTimers();
  });

  it('rejects a recently started slot after the configured grace period', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-24T17:06:00.000Z'));
    const prisma = {
      spaService: { findUnique: jest.fn().mockResolvedValue(fixedService) },
      spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.create(admin, {
        serviceId: 'service-id',
        startAt: '2026-10-24T17:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    jest.useRealTimers();
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
        findUnique: jest.fn().mockResolvedValue(null),
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
    ).resolves.toEqual({ ...appointment, customerStatus: 'new' });
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

  it('honors an explicitly selected professional instead of assigning randomly', async () => {
    const appointment = { id: 'appointment-id', professionalId: 'pro-fixed' };
    const prisma = {
      spaService: { findUnique: jest.fn().mockResolvedValue(fixedService) },
      spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
      professionalService: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({
          professional: { commissionRate: new Prisma.Decimal(40) },
        }),
      },
      professionalSchedule: {
        findFirst: jest.fn().mockResolvedValue({ id: 'schedule-id' }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'customer-id',
          name: 'Ana',
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

    await service.create(admin, {
      serviceId: 'service-id',
      professionalId: 'pro-fixed',
      customerId: 'customer-id',
      startAt: future()!,
    });

    expect(prisma.professionalService.findMany).not.toHaveBeenCalled();
    expect(prisma.professionalService.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ professionalId: 'pro-fixed' }),
      }),
    );
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ professionalId: 'pro-fixed' }),
      }),
    );
  });

  it('rejects a second active appointment in the same category and local day', async () => {
    const categorizedService = { ...fixedService, categoryId: 'nails-id' };
    const prisma = {
      spaService: {
        findUnique: jest.fn().mockResolvedValue(categorizedService),
      },
      spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 'customer-id' }),
      },
      appointment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing-appointment' }),
      },
      professionalService: { findMany: jest.fn() },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.create(admin, {
        serviceId: 'service-id',
        customerId: 'customer-id',
        startAt: future()!,
      }),
    ).rejects.toThrow(
      'Esta clienta ya tiene una cita de esta categoría en la fecha seleccionada',
    );
    expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        customerId: 'customer-id',
        serviceCategoryId: 'nails-id',
        status: { not: 'CANCELLED' },
      }),
      select: { id: true },
    });
    expect(prisma.professionalService.findMany).not.toHaveBeenCalled();
  });

  it('reuses an existing customer by national id without changing their data', async () => {
    const existing = {
      id: 'customer-id',
      name: 'Ana Pérez',
      nationalId: '12345678',
      phone: '04120000000',
      email: 'ana@example.com',
    };
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
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
        update: jest.fn(),
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
        customerName: 'Otro nombre',
        customerNationalId: '12345678',
        customerPhone: '04149999999',
        customerEmail: 'otro@example.com',
      }),
    ).resolves.toEqual({ ...appointment, customerStatus: 'recurring' });
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'customer-id',
          customerName: 'Ana Pérez',
          customerPhone: '04120000000',
          customerEmail: 'ana@example.com',
        }),
      }),
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

  it('emails a remote appointment when the dashboard changes or cancels it', async () => {
    const mail = {
      sendBookingCancellation: jest.fn().mockResolvedValue(undefined),
      sendBookingUpdate: jest.fn().mockResolvedValue(undefined),
    };
    const current = {
      id: '6fd984f7-a0a7-403b-a63a-d104a461d8a2',
      spaId: 'spa-id',
      status: 'CONFIRMED',
      customerName: 'Ana',
      startAt: new Date('2030-01-10T14:00:00.000Z'),
      endAt: new Date('2030-01-10T15:00:00.000Z'),
      professionalId: 'pro-id',
      service: { ...fixedService, name: 'Manos Sencillas' },
      bookingRequest: { id: 'request-id', email: 'ana@example.com', token: 'token' },
    };
    const prisma = {
      appointment: {
        findFirst: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({
          ...current,
          status: 'CANCELLED',
          professionalId: 'pro-id',
          startAt: current.startAt,
        }),
      },
      bookingRequest: { update: jest.fn().mockResolvedValue({}) },
      spa: { findUnique: jest.fn().mockResolvedValue({ name: 'EmiNails', timezone: 'America/Caracas' }) },
      professional: { findFirst: jest.fn().mockResolvedValue({ displayName: 'Ana M' }) },
    };
    const service = new AppointmentsService(
      prisma as never,
      audit as never,
      mail as never,
      { get: () => 'http://localhost:3002' } as never,
    );

    await service.update(admin, current.id, { status: 'CANCELLED' });

    expect(mail.sendBookingCancellation).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ana@example.com', serviceName: 'Manos Sencillas' }),
    );
    expect(mail.sendBookingUpdate).not.toHaveBeenCalled();
    expect(prisma.bookingRequest.update).toHaveBeenCalled();
  });

  it('cancels one service of a visit without cancelling the others', async () => {
    const mail = {
      sendBookingCancellation: jest.fn().mockResolvedValue(undefined),
      sendBookingUpdate: jest.fn().mockResolvedValue(undefined),
    };
    const current = {
      id: 'second-id',
      spaId: 'spa-id',
      status: 'CONFIRMED',
      customerName: 'Ana',
      startAt: new Date('2030-01-10T15:00:00.000Z'),
      endAt: new Date('2030-01-10T16:00:00.000Z'),
      professionalId: 'pro-b',
      visitRequestId: 'visit-id',
      service: { ...fixedService, name: 'Corte' },
      bookingRequest: null,
      visitRequest: { id: 'visit-id', email: 'ana@example.com', token: 'token', appointmentId: 'first-id' },
    };
    const prisma = {
      appointment: {
        findFirst: jest.fn().mockResolvedValue(current),
        findMany: jest.fn().mockResolvedValue([{ ...current, id: 'first-id' }, current]),
        update: jest.fn().mockResolvedValue({ ...current, status: 'CANCELLED' }),
        count: jest.fn().mockResolvedValue(1),
      },
      bookingRequest: { update: jest.fn().mockResolvedValue({}) },
      spa: { findUnique: jest.fn().mockResolvedValue({ name: 'EmiNails', timezone: 'America/Caracas' }) },
      professional: { findFirst: jest.fn().mockResolvedValue({ displayName: 'Andrea' }) },
    };
    const service = new AppointmentsService(
      prisma as never,
      audit as never,
      mail as never,
      { get: () => 'http://localhost:3002' } as never,
    );

    await service.update(admin, current.id, { status: 'CANCELLED', scope: 'segment' });

    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_spaId: { id: 'second-id', spaId: 'spa-id' } } }),
    );
    expect(prisma.bookingRequest.update).not.toHaveBeenCalled();
    expect(mail.sendBookingCancellation).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'Corte', reference: 'Código VF-FIRSTID.' }),
    );
  });

  it('refuses to delay a multi-service visit when a later service would pass closing', async () => {
    const start = DateTime.fromISO('2030-01-10T16:00:00.000Z', { setZone: true });
    const first = {
      id: 'first-id',
      spaId: 'spa-id',
      status: 'CONFIRMED',
      startAt: start.toJSDate(),
      endAt: start.plus({ hours: 1 }).toJSDate(),
      professionalId: 'pro-a',
      serviceId: 'service-a',
      customerId: 'customer-id',
      customerName: 'Ana',
      serviceCategoryId: 'cat-a',
      visitRequestId: 'visit-id',
      service: { ...fixedService, name: 'Manos' },
      professional: { displayName: 'Ana' },
      bookingRequest: null,
      visitRequest: { id: 'visit-id', email: 'ana@example.com', token: 'token', appointmentId: 'first-id' },
    };
    const secondStart = start.plus({ hours: 1 });
    const second = {
      ...first,
      id: 'second-id',
      professionalId: 'pro-b',
      serviceCategoryId: 'cat-b',
      startAt: secondStart.toJSDate(),
      endAt: secondStart.plus({ hours: 1 }).toJSDate(),
      service: { ...fixedService, name: 'Corte' },
      professional: { displayName: 'Andrea' },
    };
    const prisma = {
      appointment: {
        findFirst: jest.fn().mockResolvedValueOnce(first).mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([first, second]),
      },
      professionalSchedule: { findFirst: jest.fn().mockResolvedValue({ id: 'schedule' }) },
      spa: { findUniqueOrThrow: jest.fn().mockResolvedValue(spa) },
    };
    const service = new AppointmentsService(prisma as never, audit as never);

    await expect(
      service.update(admin, first.id, { delayMinutes: 30 }),
    ).rejects.toThrow(/reprogramarla/);
    expect(prisma.appointment.findMany).toHaveBeenCalled();
  });
});
