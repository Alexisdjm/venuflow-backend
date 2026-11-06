import { PublicBookingService } from '../../src/modules/public-booking/public-booking.service';
import { AvailabilityService } from '../../src/modules/availability/availability.service';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SpasService } from '../../src/modules/spas/spas.service';
import { AppointmentsService } from '../../src/modules/appointments/appointments.service';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { MailService } from '../../src/modules/mail/mail.service';
import { PublicBookingRequestsService } from '../../src/modules/public-booking/public-booking-requests.service';
import { bookingTokenHash } from '../../src/modules/public-booking/booking-tokens';
import { Prisma } from '../../src/generated/prisma/client';

describe('Block A public booking security (real PostgreSQL)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let api: PublicBookingRequestsService;
  let spaId: string,
    slug: string,
    serviceId: string,
    secondServiceId: string,
    professionalId: string;
  let start: string;
  const ownedSpas: string[] = [];
  const mail = {
    sendBookingVerification: jest.fn().mockResolvedValue(undefined),
    sendBookingCancellation: jest.fn().mockResolvedValue(undefined),
    sendBookingUpdate: jest.fn().mockResolvedValue(undefined),
  };
  const customer = {
    name: 'Guest Example',
    phone: '04141234567',
    email: 'guest@example.test',
    nationalId: '12345678',
  };

  beforeAll(async () => {
    // Never run these fixtures against development, staging or production.
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '5433' ||
      url.pathname !== '/venueflow_test'
    ) {
      throw new Error(
        'This suite requires the isolated venueflow_test database on localhost:5433',
      );
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    db = app.get(PrismaService);
    api = app.get(PublicBookingRequestsService);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    slug = `security-a-${randomUUID()}`;
    const spa = await db.spa.create({
      data: {
        name: 'Security A',
        slug,
        timezone: 'America/Caracas',
        currency: 'USD',
      },
    });
    spaId = spa.id;
    ownedSpas.push(spaId);
    const user = await db.user.create({
      data: {
        spaId,
        firstName: 'Pro',
        lastName: 'Test',
        email: `${slug}@example.test`,
        passwordHash: 'not-a-login-fixture',
        role: 'PROFESSIONAL',
      },
    });
    const pro = await db.professional.create({
      data: {
        spaId,
        userId: user.id,
        displayName: 'Test professional',
        commissionRate: '20',
      },
    });
    professionalId = pro.id;
    for (const index of [0, 1]) {
      const category = await db.serviceCategory.create({
        data: {
          spaId,
          name: `Category ${index}`,
          normalizedName: `category ${index}`,
        },
      });
      const service = await db.spaService.create({
        data: {
          spaId,
          categoryId: category.id,
          name: `Service ${index}`,
          durationMinutes: 30,
          price: '25',
        },
      });
      if (index === 0) serviceId = service.id;
      else secondServiceId = service.id;
      await db.professionalService.create({
        data: { spaId, professionalId, serviceId: service.id },
      });
    }
    const local = DateTime.now()
      .setZone('America/Caracas')
      .plus({ days: 2 })
      .startOf('day')
      .plus({ hours: 10 });
    start = local.toUTC().toISO()!;
    await db.professionalSchedule.create({
      data: {
        spaId,
        professionalId,
        dayOfWeek: local.weekday % 7,
        startMinute: 540,
        endMinute: 1080,
      },
    });
  });

  afterAll(async () => {
    if (db && ownedSpas.length) {
      const where = { spaId: { in: ownedSpas } };
      // Only fixtures owned by this suite; no truncate, reset or shared-data deletion.
      await db.appointment.deleteMany({ where });
      await db.bookingRequest.deleteMany({ where });
      await db.customer.deleteMany({ where });
      await db.auditLog.deleteMany({ where });
      await db.professionalSchedule.deleteMany({ where });
      await db.professionalService.deleteMany({ where });
      await db.spaService.deleteMany({ where });
      await db.serviceCategory.deleteMany({ where });
      await db.professional.deleteMany({ where });
      await db.user.deleteMany({ where });
      await db.spa.deleteMany({ where: { id: { in: ownedSpas } } });
    }
    await app?.close();
  });

  async function pending(
    overrides: Partial<typeof customer> = {},
    multiple = false,
  ) {
    const body = {
      spaSlug: slug,
      serviceIds: multiple ? [serviceId, secondServiceId] : [serviceId],
      professionalId,
      start,
      customer: { ...customer, ...overrides },
      ...(multiple
        ? {
            sameProfessional: true,
            items: [
              { serviceId, professionalId },
              { serviceId: secondServiceId, professionalId },
            ],
          }
        : {}),
    };
    const result = await api.create(body);
    const sent = mail.sendBookingVerification.mock.calls.at(-1)![0];
    const token = new URL(sent.verificationUrl).searchParams.get('token')!;
    const row = await db.bookingRequest.findUniqueOrThrow({
      where: { id: result.requestId.split('.')[0] },
    });
    return { ...result, token, row, sent };
  }

  it('does not create or associate a customer until verification; hashes the token', async () => {
    const p = await pending();
    expect(p.row.customerId).toBeNull();
    expect(await db.customer.count({ where: { spaId } })).toBe(0);
    expect(p.row.token).toBe(bookingTokenHash(p.token, 'verification'));
    expect(p.row.tokenVersion).toBe(1);
    expect(p.row.token).not.toBe(p.token);
    const receipt = await api.confirm(p.token, randomUUID());
    expect(receipt.status).toBe('CONFIRMED');
    const saved = await db.bookingRequest.findUniqueOrThrow({
      where: { id: p.row.id },
    });
    expect(saved.customerId).not.toBeNull();
    expect(saved.receiptToken).toBe(
      bookingTokenHash(receipt.receiptToken, 'receipt'),
    );
    expect(await api.confirmation(receipt.receiptToken)).toEqual(receipt);
  });

  it.each([{ email: 'different@example.test' }, { name: 'Different Name' }])(
    'refuses contradictory identity only after verification, without leaking stored data: %j',
    async (change) => {
      const stored = await db.customer.create({ data: { spaId, ...customer } });
      const p = await pending(change);
      expect(p.row.customerId).toBeNull();
      expect(p.sent.customerName).toBe(change.name ?? customer.name);
      const details = await api.details(p.token);
      expect(JSON.stringify(details)).not.toContain(customer.email);
      expect(JSON.stringify(details)).not.toContain(customer.phone);
      await expect(api.confirm(p.token, randomUUID())).rejects.toMatchObject({
        status: 409,
      });
      expect(
        await db.customer.findUnique({ where: { id: stored.id } }),
      ).toEqual(stored);
      expect(await db.appointment.count({ where: { spaId } })).toBe(0);
    },
  );

  it('does not disclose an existing private name in mail or HTTP output', async () => {
    await db.customer.create({
      data: {
        spaId,
        ...customer,
        name: 'PRIVATE STORED NAME',
        phone: 'PRIVATE PHONE',
      },
    });
    const response = await request(app.getHttpServer())
      .post('/api/v1/public/booking-requests')
      .send({
        spaSlug: slug,
        serviceIds: [serviceId],
        professionalId,
        start,
        customer,
      })
      .expect(201);
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
    expect(
      JSON.stringify(mail.sendBookingVerification.mock.calls),
    ).not.toContain('PRIVATE');
  });

  it('reuses a matching existing contact only after email verification and never overwrites it', async () => {
    const stored = await db.customer.create({ data: { spaId, ...customer } });
    const p = await pending({
      phone: '04149999999',
      name: '  GUEST   Example  ',
    });
    await api.confirm(p.token, randomUUID());
    const appointment = await db.appointment.findFirstOrThrow({
      where: { spaId },
    });
    expect(appointment.customerId).toBe(stored.id);
    expect(appointment.customerPhone).toBe('04149999999');
    expect(await db.customer.findUnique({ where: { id: stored.id } })).toEqual(
      stored,
    );
  });

  it('creates no identity records for concurrent unverified requests with the same national ID', async () => {
    const results = await Promise.all([
      pending(),
      pending({ email: 'other@example.test' }),
    ]);
    expect(results.every((p) => p.row.customerId === null)).toBe(true);
    expect(await db.customer.count({ where: { spaId } })).toBe(0);
    expect(await db.bookingRequest.count({ where: { spaId } })).toBe(2);
  });

  it('keeps customer uniqueness under concurrent verified identity creation', async () => {
    const a = await pending();
    start = DateTime.fromISO(start).plus({ hours: 2 }).toISO()!;
    const b = await pending();
    const results = await Promise.allSettled([
      api.confirm(a.token, randomUUID()),
      api.confirm(b.token, randomUUID()),
    ]);
    expect(await db.customer.count({ where: { spaId } })).toBe(1);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .every((r) => r.status === 'rejected' && r.reason?.status === 409),
    ).toBe(true);
  });

  it.each([false, true])(
    'blocks suspended spa confirmation (multiple=%s), retaining cancellation',
    async (multiple) => {
      const p = await pending({}, multiple);
      await db.spa.update({
        where: { id: spaId },
        data: { status: 'SUSPENDED' },
      });
      await expect(api.confirm(p.token, randomUUID())).rejects.toMatchObject({
        status: 409,
      });
      expect(await api.cancel(p.token)).toEqual({ status: 'CANCELLED' });
    },
  );

  it.each(['inactive', 'price', 'duration', 'priceType', 'durationType'])(
    'rejects changed service conditions: %s',
    async (condition) => {
      const p = await pending();
      const changes = {
        inactive: { isActive: false },
        price: { price: '30' },
        duration: { durationMinutes: 60 },
        priceType: { priceType: 'VARIABLE' as const },
        durationType: { durationType: 'VARIABLE' as const },
      };
      await db.spaService.update({
        where: { id: serviceId },
        data: changes[condition as keyof typeof changes],
      });
      await expect(api.confirm(p.token, randomUUID())).rejects.toMatchObject({
        status: 409,
      });
      expect(await db.appointment.count({ where: { spaId } })).toBe(0);
    },
  );

  it.each(['inactive', 'unassigned', 'no-shift'])(
    'rejects a professional no longer eligible: %s',
    async (condition) => {
      const p = await pending();
      if (condition === 'inactive')
        await db.professional.update({
          where: { id: professionalId },
          data: { isActive: false },
        });
      if (condition === 'unassigned')
        await db.professionalService.deleteMany({
          where: { spaId, serviceId },
        });
      if (condition === 'no-shift')
        await db.professionalSchedule.updateMany({
          where: { spaId },
          data: { isActive: false },
        });
      await expect(api.confirm(p.token, randomUUID())).rejects.toMatchObject({
        status: 409,
      });
    },
  );

  it('rejects expiry and cancelled requests', async () => {
    const p = await pending();
    await db.bookingRequest.update({
      where: { id: p.row.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(api.confirm(p.token, randomUUID())).rejects.toMatchObject({
      status: 410,
    });
    const cancelled = await pending();
    await api.cancel(cancelled.token);
    await expect(
      api.confirm(cancelled.token, randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('confirms a sequence atomically and rejects a changed second service', async () => {
    const p = await pending({}, true);
    await db.spaService.update({
      where: { id: secondServiceId },
      data: { isActive: false },
    });
    await expect(api.confirm(p.token, randomUUID())).rejects.toMatchObject({
      status: 409,
    });
    expect(await db.appointment.count({ where: { spaId } })).toBe(0);
    await db.spaService.update({
      where: { id: secondServiceId },
      data: { isActive: true },
    });
    await api.confirm(p.token, randomUUID());
    expect(
      await db.appointment.count({
        where: { spaId, visitRequestId: p.row.id },
      }),
    ).toBe(2);
  });

  it('does not authorize resend with a UUID; accepts only its distinct capability', async () => {
    const p = await pending();
    await db.bookingRequest.update({
      where: { id: p.row.id },
      data: { resendAvailableAt: new Date(0) },
    });
    await expect(api.resend(p.row.id)).rejects.toMatchObject({ status: 404 });
    await expect(api.resend(`${p.row.id}.${p.token}`)).rejects.toMatchObject({
      status: 404,
    });
    await api.resend(p.requestId);
    expect(mail.sendBookingVerification).toHaveBeenCalledTimes(2);
    await expect(api.resend(p.requestId)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('lets only one concurrent resend claim the cooldown', async () => {
    const p = await pending();
    await db.bookingRequest.update({
      where: { id: p.row.id },
      data: { resendAvailableAt: new Date(0) },
    });
    const results = await Promise.allSettled([
      api.resend(p.requestId),
      api.resend(p.requestId),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(mail.sendBookingVerification).toHaveBeenCalledTimes(2);
  });

  it('still returns a confirmed receipt when the audit follow-up fails', async () => {
    const p = await pending();
    jest
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('audit down'));
    await expect(api.confirm(p.token, randomUUID())).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
  });

  it('limits repeated public requests for the same spa and email', async () => {
    for (let index = 0; index < 5; index += 1) {
      await pending({
        nationalId: String(22345670 + index),
        email: 'quota@example.test',
      });
    }
    await expect(
      pending({ nationalId: '22345679', email: 'quota@example.test' }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('separates bearer purposes, rejects stored hashes and redacts credentials in errors', async () => {
    const p = await pending();
    const receipt = await api.confirm(p.token, randomUUID());
    await expect(api.details(receipt.receiptToken)).rejects.toMatchObject({
      status: 404,
    });
    await expect(api.confirmation(p.token)).rejects.toMatchObject({
      status: 404,
    });
    await expect(api.details(p.row.token)).rejects.toMatchObject({
      status: 404,
    });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/public/booking-verifications/${receipt.receiptToken}`)
      .expect(404);
    expect(JSON.stringify(response.body)).not.toContain(receipt.receiptToken);
  });

  it('expires new verification access without expiring valid receipt access', async () => {
    const p = await pending();
    const receipt = await api.confirm(p.token, randomUUID());
    await db.bookingRequest.update({
      where: { id: p.row.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(api.details(p.token)).rejects.toMatchObject({ status: 410 });
    await db.spa.update({
      where: { id: spaId },
      data: { status: 'SUSPENDED' },
    });
    expect((await api.confirmation(receipt.receiptToken)).status).toBe(
      'CONFIRMED',
    );
    await api.cancelConfirmed(receipt.receiptToken);
    await expect(api.confirmation(receipt.receiptToken)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('preserves existing confirmed legacy links and refuses unsafe legacy pending prices', async () => {
    const p = await pending();
    const receipt = await api.confirm(p.token, randomUUID());
    const legacyToken = 'legacy-verification-link';
    const legacyReceipt = 'legacy-receipt-link';
    await db.bookingRequest.update({
      where: { id: p.row.id },
      data: {
        tokenVersion: 0,
        token: legacyToken,
        receiptToken: legacyReceipt,
        expiresAt: new Date(0),
      },
    });
    expect((await api.details(legacyToken)).receiptToken).toBe(legacyReceipt);
    expect((await api.confirmation(legacyReceipt)).bookingCode).toBe(
      receipt.bookingCode,
    );
    start = DateTime.fromISO(start).plus({ hours: 2 }).toISO()!;
    const pendingLegacy = await pending();
    await db.bookingRequest.update({
      where: { id: pendingLegacy.row.id },
      data: {
        tokenVersion: 0,
        token: 'legacy-pending',
        segments: Prisma.DbNull,
      },
    });
    await expect(
      api.confirm('legacy-pending', randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects cross-spa services, professionals and forged sequence segments', async () => {
    const other = await db.spa.create({
      data: {
        name: 'Other',
        slug: `other-${randomUUID()}`,
        timezone: 'UTC',
        currency: 'USD',
      },
    });
    ownedSpas.push(other.id);
    const category = await db.serviceCategory.create({
      data: { spaId: other.id, name: 'Other', normalizedName: 'other' },
    });
    const foreign = await db.spaService.create({
      data: {
        spaId: other.id,
        categoryId: category.id,
        name: 'Other service',
        durationMinutes: 30,
        price: '25',
      },
    });
    await expect(
      api.create({ spaSlug: slug, serviceIds: [foreign.id], start, customer }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      api.create({
        spaSlug: other.slug,
        serviceIds: [foreign.id],
        professionalId,
        start,
        customer,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const p = await pending({}, true);
    const segments = p.row.segments as unknown as { serviceId: string }[];
    segments[1].serviceId = foreign.id;
    await db.bookingRequest.update({
      where: { id: p.row.id },
      data: { segments: segments as unknown as Prisma.InputJsonValue },
    });
    await expect(api.confirm(p.token, randomUUID())).rejects.toMatchObject({
      status: 409,
    });
    expect(await db.appointment.count({ where: { spaId } })).toBe(0);
  });

  it('rejects corrupted cross-tenant request/appointment links for reads and cancellation', async () => {
    const p = await pending();
    const receipt = await api.confirm(p.token, randomUUID());
    const primary = await db.appointment.findFirstOrThrow({ where: { spaId } });
    const other = await db.spa.create({
      data: {
        name: 'Foreign',
        slug: `foreign-${randomUUID()}`,
        timezone: 'UTC',
        currency: 'USD',
      },
    });
    ownedSpas.push(other.id);
    const category = await db.serviceCategory.create({
      data: { spaId: other.id, name: 'Foreign', normalizedName: 'foreign' },
    });
    const user = await db.user.create({
      data: {
        spaId: other.id,
        firstName: 'Other',
        lastName: 'Pro',
        email: `${other.id}@example.test`,
        passwordHash: 'unused',
        role: 'PROFESSIONAL',
      },
    });
    const pro = await db.professional.create({
      data: {
        spaId: other.id,
        userId: user.id,
        displayName: 'Foreign private name',
        commissionRate: '10',
      },
    });
    const service = await db.spaService.create({
      data: {
        spaId: other.id,
        categoryId: category.id,
        name: 'Foreign private service',
        price: '50',
        durationMinutes: 30,
      },
    });
    const client = await db.customer.create({
      data: { spaId: other.id, ...customer },
    });
    const appointment = await db.appointment.create({
      data: {
        spaId: other.id,
        professionalId: pro.id,
        serviceId: service.id,
        customerId: client.id,
        customerName: client.name,
        customerPhone: client.phone,
        startAt: primary.startAt,
        endAt: primary.endAt,
        appointmentDate: primary.appointmentDate,
        serviceCategoryId: category.id,
        servicePrice: '50',
        commissionRate: '10',
      },
    });
    await expect(
      db.bookingRequest.update({
        where: { id: p.row.id },
        data: { appointmentId: appointment.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.appointment.update({
        where: { id: appointment.id },
        data: { visitRequestId: p.row.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.bookingRequest.update({
        where: { id: p.row.id },
        data: { professionalId: pro.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect((await api.confirmation(receipt.receiptToken)).status).toBe(
      'CONFIRMED',
    );
    expect(
      (
        await db.appointment.findUniqueOrThrow({
          where: { id: appointment.id },
        })
      ).status,
    ).toBe('CONFIRMED');
  });

  it('administrative rescheduling sends a usable receipt link rather than a stored digest', async () => {
    const p = await pending();
    const receipt = await api.confirm(p.token, randomUUID());
    const appointment = await db.appointment.findFirstOrThrow({
      where: { spaId },
    });
    const user = await db.user.findFirstOrThrow({ where: { spaId } });
    await app
      .get(AppointmentsService)
      .update(
        { sub: user.id, spaId, role: user.role, email: user.email },
        appointment.id,
        {
          startAt: DateTime.fromISO(start).plus({ hours: 1 }).toUTC().toISO()!,
        },
      );
    const message = mail.sendBookingUpdate.mock.calls.at(-1)![0];
    const link = new URL(message.verificationUrl);
    expect(link.pathname).toBe('/booking/confirmation');
    expect(link.searchParams.get('token')).toBe(receipt.receiptToken);
    expect(
      (await api.confirmation(link.searchParams.get('token')!)).status,
    ).toBe('CONFIRMED');
  });
  it('runs create, resend, confirmation, receipt and cancellation on two spas without mixing links or records', async () => {
    const otherSlug = `spa-b-${randomUUID()}`;
    const other = await db.spa.create({
      data: {
        name: 'Spa B',
        slug: otherSlug,
        timezone: 'America/Caracas',
        currency: 'USD',
      },
    });
    ownedSpas.push(other.id);
    const otherUser = await db.user.create({
      data: {
        spaId: other.id,
        firstName: 'Bea',
        lastName: 'Pro',
        email: `${otherSlug}@example.test`,
        passwordHash: 'not-a-login-fixture',
        role: 'PROFESSIONAL',
      },
    });
    const otherPro = await db.professional.create({
      data: {
        spaId: other.id,
        userId: otherUser.id,
        displayName: 'Spa B professional',
        commissionRate: '20',
      },
    });
    const otherCategory = await db.serviceCategory.create({
      data: { spaId: other.id, name: 'Spa B', normalizedName: 'spa b' },
    });
    const otherService = await db.spaService.create({
      data: {
        spaId: other.id,
        categoryId: otherCategory.id,
        name: 'Spa B service',
        durationMinutes: 30,
        price: '40',
      },
    });
    await db.professionalService.create({
      data: { spaId: other.id, professionalId: otherPro.id, serviceId: otherService.id },
    });
    const local = DateTime.fromISO(start, { setZone: true }).setZone('America/Caracas');
    await db.professionalSchedule.create({
      data: {
        spaId: other.id,
        professionalId: otherPro.id,
        dayOfWeek: local.weekday % 7,
        startMinute: 540,
        endMinute: 1080,
      },
    });
    const guestB = { ...customer, name: 'Bea B', email: 'bea-b@example.test' };
    const createdA = await pending({ name: 'Ana A', email: 'ana-a@example.test' });
    const createdB = await api.create({
      spaSlug: otherSlug,
      serviceIds: [otherService.id],
      professionalId: otherPro.id,
      start,
      customer: guestB,
    });
    const latestMail = (spaName: string) =>
      [...mail.sendBookingVerification.mock.calls]
        .reverse()
        .find((call) => call[0].spaName === spaName)![0];
    const mailA = latestMail('Security A');
    const mailB = latestMail('Spa B');
    const linkA = new URL(mailA.verificationUrl);
    const linkB = new URL(mailB.verificationUrl);
    const tokenA = linkA.searchParams.get('token')!;
    const tokenB = linkB.searchParams.get('token')!;
    const idB = createdB.requestId.split('.')[0];

    expect(linkA.hostname).toBe(`${slug}.localhost`);
    expect(linkB.hostname).toBe(`${otherSlug}.localhost`);
    expect(linkA.pathname).toBe('/booking/verify');
    expect(tokenA).not.toBe(tokenB);
    expect((await api.details(tokenA)).spaName).toBe('Security A');
    expect((await api.details(tokenA)).serviceNames).toEqual(['Service 0']);
    expect((await api.details(tokenB)).serviceNames).toEqual(['Spa B service']);
    await expect(
      api.resend(`${idB}.${createdA.requestId.slice(createdA.requestId.indexOf('.') + 1)}`),
    ).rejects.toMatchObject({ status: 404 });

    await db.bookingRequest.updateMany({
      where: { id: { in: [createdA.row.id, idB] } },
      data: { resendAvailableAt: new Date(0) },
    });
    await api.resend(createdA.requestId);
    await api.resend(createdB.requestId);
    expect(new URL(latestMail('Security A').verificationUrl).hostname).toBe(`${slug}.localhost`);
    expect(new URL(latestMail('Spa B').verificationUrl).searchParams.get('token')).toBe(tokenB);

    const receiptA = await api.confirm(tokenA, randomUUID());
    const receiptB = await api.confirm(tokenB, randomUUID());
    expect(receiptA.spaName).toBe('Security A');
    expect(receiptB.spaName).toBe('Spa B');
    expect(receiptA.serviceNames).toEqual(['Service 0']);
    expect(receiptB.serviceNames).toEqual(['Spa B service']);
    expect(receiptA.receiptToken).not.toBe(receiptB.receiptToken);
    expect(receiptA.appointments.map((item) => item.serviceName)).toEqual(['Service 0']);
    expect((await api.confirmation(receiptB.receiptToken)).requestId).toBe(idB);

    expect(await db.customer.findMany({ where: { spaId }, select: { name: true, nationalId: true } })).toEqual([
      { name: 'Ana A', nationalId: customer.nationalId },
    ]);
    expect(await db.customer.findMany({ where: { spaId: other.id }, select: { name: true, nationalId: true } })).toEqual([
      { name: 'Bea B', nationalId: customer.nationalId },
    ]);

    const pendingB = await api.create({
      spaSlug: otherSlug,
      serviceIds: [otherService.id],
      professionalId: otherPro.id,
      start: DateTime.fromISO(start).plus({ hours: 3 }).toUTC().toISO()!,
      customer: guestB,
    });
    const pendingToken = new URL(latestMail('Spa B').verificationUrl).searchParams.get('token')!;
    await api.cancel(pendingToken);
    expect((await api.details(pendingToken)).status).toBe('CANCELLED');
    expect((await api.details(pendingToken)).requestId).toBe(pendingB.requestId.split('.')[0]);
    expect((await api.confirmation(receiptB.receiptToken)).status).toBe('CONFIRMED');

    await api.cancelConfirmed(receiptA.receiptToken);
    await expect(api.confirmation(receiptA.receiptToken)).rejects.toMatchObject({ status: 404 });
    expect((await api.confirmation(receiptB.receiptToken)).spaName).toBe('Spa B');

    await api.cancelConfirmed(receiptB.receiptToken);
    await expect(api.confirmation(receiptB.receiptToken)).rejects.toMatchObject({ status: 404 });
    expect(await db.appointment.count({ where: { spaId, status: 'CANCELLED' } })).toBe(1);
    expect(await db.appointment.count({ where: { spaId: other.id, status: 'CANCELLED' } })).toBe(1);
    expect(await db.appointment.count({ where: { spaId: other.id, status: 'CONFIRMED' } })).toBe(0);
  });

  describe('Block B transactional integrity', () => {
    it.each(['primary', 'visit', 'professional', 'admins', 'clean'])(
      'migration preflight rejects inconsistent legacy data without editing it: %s',
      async (kind) => {
        const connection = new Client({
          connectionString: process.env.DATABASE_URL,
        });
        await connection.connect();
        try {
          await connection.query(`CREATE TEMP TABLE "BookingRequest" (id text, "spaId" text, "appointmentId" text, "professionalId" text);
          CREATE TEMP TABLE "Appointment" (id text, "spaId" text, "visitRequestId" text);
          CREATE TEMP TABLE "Professional" (id text, "spaId" text);
          CREATE TEMP TABLE "User" ("spaId" text, role text);`);
          if (kind === 'primary')
            await connection.query(
              `INSERT INTO "BookingRequest" VALUES ('r','a','p',NULL); INSERT INTO "Appointment" VALUES ('p','b',NULL)`,
            );
          if (kind === 'visit')
            await connection.query(
              `INSERT INTO "BookingRequest" VALUES ('r','b',NULL,NULL); INSERT INTO "Appointment" VALUES ('p','a','r')`,
            );
          if (kind === 'professional')
            await connection.query(
              `INSERT INTO "BookingRequest" VALUES ('r','a',NULL,'p'); INSERT INTO "Professional" VALUES ('p','b')`,
            );
          if (kind === 'admins')
            await connection.query(
              `INSERT INTO "User" VALUES ('a','SPA_ADMIN'),('a','SPA_ADMIN')`,
            );
          const before = await connection.query(
            'SELECT count(*)::int AS count FROM "BookingRequest"',
          );
          const preflight = readFileSync(
            join(
              process.cwd(),
              'prisma/migrations/20261106000000_public_booking_integrity_b/migration.sql',
            ),
            'utf8',
          ).split('\nBEGIN;')[0];
          if (kind === 'clean')
            await expect(connection.query(preflight)).resolves.toBeDefined();
          else
            await expect(connection.query(preflight)).rejects.toMatchObject({
              code: 'P0001',
              message: expect.stringContaining('preflight failed'),
            });
          expect(
            (
              await connection.query(
                'SELECT count(*)::int AS count FROM "BookingRequest"',
              )
            ).rows,
          ).toEqual(before.rows);
        } finally {
          await connection.end();
        }
      },
    );

    const confirmHttp = (token: string, key: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/public/booking-verifications/${token}/confirm`)
        .set('Idempotency-Key', key);
    it.each([false, true])(
      'same-key parallel confirmations return exactly one reservation (multiple=%s)',
      async (multiple) => {
        const p = await pending({}, multiple);
        const key = randomUUID();
        const results = await Promise.all([
          confirmHttp(p.token, key),
          confirmHttp(p.token, key),
        ]);
        expect(results.map((r) => r.status)).toEqual([201, 201]);
        expect(results[0].body).toEqual(results[1].body);
        expect(await db.appointment.count({ where: { spaId } })).toBe(
          multiple ? 2 : 1,
        );
        expect(await db.customer.count({ where: { spaId } })).toBe(1);
        expect(
          await db.auditLog.count({
            where: { spaId, action: 'APPOINTMENT_CREATED' },
          }),
        ).toBe(1);
      },
    );
    it.each([false, true])(
      'different-key parallel confirmations conflict without duplicate writes (multiple=%s)',
      async (multiple) => {
        const p = await pending({}, multiple);
        const results = await Promise.all([
          confirmHttp(p.token, randomUUID()),
          confirmHttp(p.token, randomUUID()),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
        expect(await db.appointment.count({ where: { spaId } })).toBe(
          multiple ? 2 : 1,
        );
      },
    );
    it('replays a lost response with the same key even after verification expiry', async () => {
      const p = await pending();
      const key = randomUUID();
      const original = await api.confirm(p.token, key);
      const clock = jest
        .spyOn(Date, 'now')
        .mockReturnValue(p.row.expiresAt.getTime() + 1);
      try {
        expect(await api.confirm(p.token, key)).toEqual(original);
        await expect(api.confirm(p.token, randomUUID())).rejects.toMatchObject({
          status: 409,
        });
        await expect(api.details(p.token)).rejects.toMatchObject({
          status: 410,
        });
      } finally {
        clock.mockRestore();
      }
      expect(await db.appointment.count({ where: { spaId } })).toBe(1);
    });
    it('two different requests cannot acquire the same slot; losing customer creation rolls back', async () => {
      const a = await pending();
      const b = await pending({
        nationalId: '87654321',
        email: 'other@example.test',
      });
      const results = await Promise.all([
        confirmHttp(a.token, randomUUID()),
        confirmHttp(b.token, randomUUID()),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await db.appointment.count({ where: { spaId } })).toBe(1);
      expect(await db.customer.count({ where: { spaId } })).toBe(1);
      const failed = await db.bookingRequest.findFirstOrThrow({
        where: { spaId, status: 'PENDING' },
      });
      expect(failed.customerId).toBeNull();
    });
    it('rolls back all segments when a later segment loses its slot', async () => {
      const sequence = await pending({}, true);
      serviceId = secondServiceId;
      start = DateTime.fromISO(start).plus({ minutes: 30 }).toUTC().toISO()!;
      const competitor = await pending({
        nationalId: '87654321',
        email: 'competitor@example.test',
      });
      await api.confirm(competitor.token, randomUUID());
      await expect(
        api.confirm(sequence.token, randomUUID()),
      ).rejects.toMatchObject({ status: 409 });
      expect(await db.appointment.count({ where: { spaId } })).toBe(1);
      expect(
        await db.appointment.count({
          where: { visitRequestId: sequence.row.id },
        }),
      ).toBe(0);
      expect(await db.customer.count({ where: { spaId } })).toBe(1);
    });
    it('confirmation and pending cancellation cannot leave an orphan confirmed appointment', async () => {
      const p = await pending();
      const results = await Promise.allSettled([
        api.confirm(p.token, randomUUID()),
        api.cancel(p.token),
      ]);
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      const row = await db.bookingRequest.findUniqueOrThrow({
        where: { id: p.row.id },
      });
      expect(await db.appointment.count({ where: { spaId } })).toBe(
        row.status === 'CONFIRMED' ? 1 : 0,
      );
      expect(['CONFIRMED', 'CANCELLED']).toContain(row.status);
    });
    it('database uniqueness prevents simultaneous provisioning of two spa administrators', async () => {
      const actor = await db.user.findFirstOrThrow({ where: { spaId } });
      const spas = app.get(SpasService);
      const dto = {
        firstName: 'Admin',
        lastName: 'Example',
        password: 'Test-only-password-2026',
      };
      const results = await Promise.allSettled([
        spas.provisionAdmin(actor.id, spaId, {
          ...dto,
          email: `a-${spaId}@example.test`,
        }),
        spas.provisionAdmin(actor.id, spaId, {
          ...dto,
          email: `b-${spaId}@example.test`,
        }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { status: 409 },
      });
      expect(await db.user.count({ where: { spaId, role: 'SPA_ADMIN' } })).toBe(
        1,
      );
    });
    it('reactivation is subject to the category-per-customer/day trigger', async () => {
      const a = await pending();
      await api.confirm(a.token, randomUUID());
      const old = await db.appointment.findFirstOrThrow({ where: { spaId } });
      await db.appointment.update({
        where: { id: old.id },
        data: { status: 'CANCELLED' },
      });
      start = DateTime.fromISO(start).plus({ hours: 2 }).toUTC().toISO()!;
      const b = await pending();
      await api.confirm(b.token, randomUUID());
      await expect(
        db.appointment.update({
          where: { id: old.id },
          data: { status: 'CONFIRMED' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(
        (await db.appointment.findUniqueOrThrow({ where: { id: old.id } }))
          .status,
      ).toBe('CANCELLED');
    });
    it('composite SET NULL deletes only the optional link and preserves the tenant', async () => {
      const p = await pending({}, true);
      await api.confirm(p.token, randomUUID());
      const row = await db.bookingRequest.findUniqueOrThrow({
        where: { id: p.row.id },
      });
      await db.appointment.delete({ where: { id: row.appointmentId! } });
      const after = await db.bookingRequest.findUniqueOrThrow({
        where: { id: p.row.id },
      });
      expect(after.appointmentId).toBeNull();
      expect(after.spaId).toBe(spaId);
      await db.bookingRequest.delete({ where: { id: p.row.id } });
      const remaining = await db.appointment.findFirstOrThrow({
        where: { spaId },
      });
      expect(remaining.visitRequestId).toBeNull();
      expect(remaining.spaId).toBe(spaId);
    });
  });
  describe('Block C public business consistency', () => {
    const dateFor = (iso: string, zone = 'America/Caracas') =>
      DateTime.fromISO(iso).setZone(zone).toISODate()!;
    const catalog = () => app.get(PublicBookingService);
    async function actor() {
      const user = await db.user.findFirstOrThrow({ where: { spaId } });
      return { sub: user.id, spaId, role: user.role, email: user.email };
    }
    it.each(['price', 'duration', 'unassigned', 'inactive'])(
      'publishes coherent eligibility: %s',
      async (kind) => {
        if (kind === 'price')
          await db.spaService.update({
            where: { id: serviceId },
            data: { priceType: 'VARIABLE' },
          });
        if (kind === 'duration')
          await db.spaService.update({
            where: { id: serviceId },
            data: { durationType: 'VARIABLE', durationMinutes: null },
          });
        if (kind === 'unassigned')
          await db.professionalService.deleteMany({
            where: { spaId, serviceId },
          });
        if (kind === 'inactive')
          await db.spaService.update({
            where: { id: serviceId },
            data: { isActive: false },
          });
        const services = await catalog().services(slug);
        const row = services.find((service) => service.id === serviceId);
        if (kind === 'inactive') {
          expect(row).toBeUndefined();
          await expect(pending()).rejects.toMatchObject({ status: 404 });
        } else {
          expect(row?.onlineBookable).toBe(false);
          expect(row?.mode).not.toBe('INSTANT');
          expect(row?.unavailableReason).toBe(
            {
              price: 'VARIABLE_PRICE',
              duration: 'VARIABLE_DURATION',
              unassigned: 'NO_ACTIVE_PROFESSIONAL',
            }[kind],
          );
          if (kind !== 'unassigned')
            await expect(
              catalog().availability(slug, {
                date: dateFor(start),
                serviceIds: serviceId,
              }),
            ).rejects.toMatchObject({ status: 400 });
          else {
            expect(
              await catalog().availability(slug, {
                date: dateFor(start),
                serviceIds: serviceId,
              }),
            ).toEqual([]);
            expect(await catalog().professionals(slug, serviceId)).toEqual([]);
          }
        }
      },
    );
    it('does not publish past/grace slots but preserves administrative grace', async () => {
      const clock = jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.parse(start) + 2 * 60_000);
      try {
        const published = await catalog().availability(slug, {
          date: dateFor(start),
          serviceIds: serviceId,
        });
        expect(published.length).toBeGreaterThan(0);
        expect(
          published.every((slot) => Date.parse(slot.start) > Date.now()),
        ).toBe(true);
        const internal = await app
          .get(AvailabilityService)
          .get(spaId, { date: dateFor(start), serviceId, intervalMinutes: 30 });
        expect(
          internal.data.some(
            (slot) => slot.start === start && slot.isGracePeriod,
          ),
        ).toBe(true);
      } finally {
        clock.mockRestore();
      }
    });
    it('aligns public slots to the actual booking grid and operating window', async () => {
      await db.professionalSchedule.updateMany({
        where: { spaId },
        data: { startMinute: 555 },
      });
      const slots = await catalog().availability(slug, {
        date: dateFor(start),
        serviceIds: serviceId,
      });
      expect(slots.length).toBeGreaterThan(0);
      expect(
        slots.every((slot) => {
          const local = DateTime.fromISO(slot.start).setZone('America/Caracas');
          return (
            local.minute % 30 === 0 &&
            local.hour >= 9 &&
            DateTime.fromISO(slot.end).setZone('America/Caracas').hour <= 18
          );
        }),
      ).toBe(true);
      start = slots[0].start;
      const p = await pending();
      expect((await api.confirm(p.token, randomUUID())).status).toBe(
        'CONFIRMED',
      );
    });
    it('every published sample is accepted by creation and confirmation', async () => {
      const slots = await catalog().availability(slug, {
        date: dateFor(start),
        serviceIds: serviceId,
      });
      for (const [index, slot] of slots.slice(0, 3).entries()) {
        start = slot.start;
        const p = await pending({
          nationalId: String(12345670 + index),
          email: `sample-${index}@example.test`,
        });
        const receipt = await api.confirm(p.token, randomUUID());
        expect(receipt.start).toBe(slot.start);
        expect(receipt.end).toBe(slot.end);
      }
    });
    it('confirms a sequence whose continuation starts off the 30-minute grid', async () => {
      await db.spaService.update({
        where: { id: serviceId },
        data: { durationMinutes: 45 },
      });
      const plans = await catalog().planSequence(slug, {
        date: dateFor(start),
        sameProfessional: true,
        items: [
          { serviceId, professionalId },
          { serviceId: secondServiceId, professionalId },
        ],
      });
      expect(plans.length).toBeGreaterThan(0);
      start = plans[0].start;
      const p = await pending({}, true);
      const receipt = await api.confirm(p.token, randomUUID());
      expect(receipt.appointments).toHaveLength(2);
      expect(receipt.appointments[1].start).toBe(receipt.appointments[0].end);
      expect(DateTime.fromISO(receipt.appointments[1].start).minute % 30).toBe(
        15,
      );
    });
    it('respects breaks represented by split shifts and days without shifts', async () => {
      const weekday =
        DateTime.fromISO(start).setZone('America/Caracas').weekday % 7;
      await db.professionalSchedule.updateMany({
        where: { spaId },
        data: { endMinute: 600 },
      });
      await db.professionalSchedule.create({
        data: {
          spaId,
          professionalId,
          dayOfWeek: weekday,
          startMinute: 630,
          endMinute: 1080,
        },
      });
      const slots = await catalog().availability(slug, {
        date: dateFor(start),
        serviceIds: serviceId,
      });
      expect(slots.some((slot) => slot.start === start)).toBe(false);
      const tomorrow = DateTime.fromISO(start).plus({ days: 1 }).toISO()!;
      expect(
        await catalog().availability(slug, {
          date: dateFor(tomorrow),
          serviceIds: serviceId,
        }),
      ).toEqual([]);
      expect(
        await catalog().planSequence(slug, {
          date: dateFor(tomorrow),
          sameProfessional: true,
          items: [{ serviceId }, { serviceId: secondServiceId }],
        }),
      ).toEqual([]);
    });
    it('keeps zero-buffer adjacent appointments valid without inventing a buffer policy', async () => {
      const first = await pending();
      const receipt = await api.confirm(first.token, randomUUID());
      start = receipt.end;
      serviceId = secondServiceId;
      const next = await pending();
      expect((await api.confirm(next.token, randomUUID())).start).toBe(
        receipt.end,
      );
    });
    it.each([false, true])(
      'receipts preserve financial snapshots after catalog changes (multiple=%s)',
      async (multiple) => {
        await db.spaService.update({
          where: { id: serviceId },
          data: { price: '25.01' },
        });
        await db.spaService.update({
          where: { id: secondServiceId },
          data: { price: '25.02' },
        });
        const p = await pending({}, multiple);
        const original = await api.confirm(p.token, randomUUID());
        await db.spaService.updateMany({
          where: { spaId },
          data: { price: '999' },
        });
        const current = await api.confirmation(original.receiptToken);
        expect(current.total).toBe(multiple ? 50.03 : 25.01);
        expect(current.appointments.every((a) => a.price < 30)).toBe(true);
        expect(JSON.stringify(current)).not.toContain('commissionRate');
      },
    );
    it.each([false, true])(
      'receipts reflect administrative rescheduling without repricing (multiple=%s)',
      async (multiple) => {
        const p = await pending({}, multiple);
        const original = await api.confirm(p.token, randomUUID());
        const first = await db.appointment.findUniqueOrThrow({
          where: { id: original.appointments[0].id },
        });
        await db.professional.update({
          where: { id: professionalId },
          data: { commissionRate: '70' },
        });
        const changed = DateTime.fromISO(start)
          .plus({ hours: 2 })
          .toUTC()
          .toISO()!;
        await app
          .get(AppointmentsService)
          .update(await actor(), first.id, { startAt: changed });
        const current = await api.confirmation(original.receiptToken);
        expect(current.start).toBe(changed);
        expect(current.total).toBe(original.total);
        expect(current.bookingCode).toBe(original.bookingCode);
        const saved = await db.appointment.findUniqueOrThrow({
          where: { id: first.id },
        });
        expect(saved.commissionRate.toString()).toBe('20');
      },
    );
    it.each([0, 1])(
      'partial cancellation excludes the cancelled segment and still permits cancelling the rest: %s',
      async (index) => {
        const p = await pending({}, true);
        const original = await api.confirm(p.token, randomUUID());
        await app
          .get(AppointmentsService)
          .update(await actor(), original.appointments[index].id, {
            status: 'CANCELLED',
            scope: 'segment',
          });
        const current = await api.confirmation(original.receiptToken);
        expect(current.partiallyCancelled).toBe(true);
        expect(current.total).toBe(25);
        expect(current.serviceNames).toHaveLength(1);
        expect(
          current.appointments.filter((a) => a.status === 'CANCELLED'),
        ).toHaveLength(1);
        await api.cancelConfirmed(original.receiptToken);
        expect(
          await db.appointment.count({ where: { spaId, status: 'CONFIRMED' } }),
        ).toBe(0);
        await expect(
          api.confirmation(original.receiptToken),
        ).rejects.toMatchObject({ status: 404 });
        expect(await api.cancelConfirmed(original.receiptToken)).toEqual({
          status: 'CANCELLED',
        });
      },
    );
    it('completed services remain visible and cannot be retroactively cancelled publicly', async () => {
      const p = await pending({}, true);
      const original = await api.confirm(p.token, randomUUID());
      await db.appointment.update({
        where: { id: original.appointments[0].id },
        data: { status: 'COMPLETED' },
      });
      expect((await api.confirmation(original.receiptToken)).total).toBe(50);
      await expect(
        api.cancelConfirmed(original.receiptToken),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await db.appointment.count({ where: { spaId, status: 'COMPLETED' } }),
      ).toBe(1);
      expect(
        await db.appointment.count({ where: { spaId, status: 'CONFIRMED' } }),
      ).toBe(1);
    });
    it('returns zone/currency and preserves the currency offered when the spa later changes it', async () => {
      await db.spa.update({
        where: { id: spaId },
        data: { timezone: 'Europe/Madrid', currency: 'EUR' },
      });
      const p = await pending();
      const original = await api.confirm(p.token, randomUUID());
      expect(original.timezone).toBe('Europe/Madrid');
      expect(original.currency).toBe('EUR');
      await db.spa.update({ where: { id: spaId }, data: { currency: 'USD' } });
      expect((await api.confirmation(original.receiptToken)).currency).toBe(
        'EUR',
      );
    });
    it.each(['currency', 'timezone'])(
      'requires a new request if pending spa conditions change: %s',
      async (field) => {
        const p = await pending();
        await db.spa.update({
          where: { id: spaId },
          data:
            field === 'currency' ? { currency: 'EUR' } : { timezone: 'UTC' },
        });
        await expect(api.confirm(p.token, randomUUID())).rejects.toMatchObject({
          status: 409,
        });
      },
    );
    it('legacy confirmed receipts use appointment price even without request snapshots', async () => {
      const p = await pending();
      const original = await api.confirm(p.token, randomUUID());
      await db.bookingRequest.update({
        where: { id: p.row.id },
        data: { segments: Prisma.DbNull },
      });
      await db.spaService.update({
        where: { id: serviceId },
        data: { price: '999' },
      });
      expect((await api.confirmation(original.receiptToken)).total).toBe(25);
    });
  });
  describe('Block C snapshot and mutation regressions', () => {
    it('explicit professional reassignment updates only the professional commission, not the agreed price', async () => {
      const p = await pending();
      const original = await api.confirm(p.token, randomUUID());
      const admin = await db.user.create({
        data: {
          spaId,
          firstName: 'Admin',
          lastName: 'Test',
          role: 'SPA_ADMIN',
          email: `admin-${spaId}@example.test`,
          passwordHash: 'unused-test-hash',
        },
      });
      const user = await db.user.create({
        data: {
          spaId,
          firstName: 'Other',
          lastName: 'Pro',
          role: 'PROFESSIONAL',
          email: `other-${spaId}@example.test`,
          passwordHash: 'unused-test-hash',
        },
      });
      const other = await db.professional.create({
        data: {
          spaId,
          userId: user.id,
          displayName: 'Other professional',
          commissionRate: '55',
        },
      });
      await db.professionalService.create({
        data: { spaId, professionalId: other.id, serviceId },
      });
      await db.professionalSchedule.create({
        data: {
          spaId,
          professionalId: other.id,
          dayOfWeek:
            DateTime.fromISO(start).setZone('America/Caracas').weekday % 7,
          startMinute: 540,
          endMinute: 1080,
        },
      });
      await db.spaService.update({
        where: { id: serviceId },
        data: { price: '999' },
      });
      await app
        .get(AppointmentsService)
        .update(
          { sub: admin.id, spaId, role: admin.role, email: admin.email },
          original.appointments[0].id,
          { professionalId: other.id },
        );
      const current = await api.confirmation(original.receiptToken);
      expect(current.professionalName).toBe('Other professional');
      expect(current.total).toBe(25);
      expect(
        (
          await db.appointment.findUniqueOrThrow({
            where: { id: original.appointments[0].id },
          })
        ).commissionRate.toString(),
      ).toBe('55');
    });
    it('public cancellation and administrative completion cannot both win', async () => {
      const p = await pending();
      const original = await api.confirm(p.token, randomUUID());
      const user = await db.user.findFirstOrThrow({ where: { spaId } });
      const clock = jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.parse(original.end) + 1);
      try {
        const results = await Promise.allSettled([
          api.cancelConfirmed(original.receiptToken),
          app
            .get(AppointmentsService)
            .update(
              { sub: user.id, spaId, role: user.role, email: user.email },
              original.appointments[0].id,
              { status: 'COMPLETED' },
            ),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const appointment = await db.appointment.findUniqueOrThrow({
          where: { id: original.appointments[0].id },
        });
        const row = await db.bookingRequest.findUniqueOrThrow({
          where: { id: p.row.id },
        });
        expect(['COMPLETED', 'CANCELLED']).toContain(appointment.status);
        expect(row.status).toBe(
          appointment.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
        );
      } finally {
        clock.mockRestore();
      }
    });
  });
});
