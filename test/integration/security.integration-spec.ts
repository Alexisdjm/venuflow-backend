import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { DateTime } from 'luxon';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma/prisma.service';

describe('PostgreSQL security integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let spaA: string,
    spaB: string,
    professionalA: string,
    professionalB: string,
    bookingService: string,
    variableService: string,
    nailsCategoryId: string,
    hairCategoryId: string,
    bookingAccessToken: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.appointment.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.professionalSchedule.deleteMany();
    await prisma.professionalService.deleteMany();
    await prisma.spaService.deleteMany();
    await prisma.serviceCategory.deleteMany();
    await prisma.professional.deleteMany();
    await prisma.user.deleteMany();
    await prisma.spa.deleteMany();
    const passwordHash = await argon2.hash('Integration-Password-2026');
    const a = await prisma.spa.create({
      data: {
        name: 'A',
        slug: 'integration-a',
        timezone: 'America/Caracas',
        currency: 'USD',
      },
    });
    const b = await prisma.spa.create({
      data: {
        name: 'B',
        slug: 'integration-b',
        timezone: 'America/Caracas',
        currency: 'USD',
      },
    });
    spaA = a.id;
    spaB = b.id;
    const nails = await prisma.serviceCategory.create({
      data: { spaId: spaA, name: 'Uñas', normalizedName: 'uñas', sortOrder: 0 },
    });
    const hair = await prisma.serviceCategory.create({
      data: {
        spaId: spaA,
        name: 'Cabello',
        normalizedName: 'cabello',
        sortOrder: 1,
      },
    });
    nailsCategoryId = nails.id;
    hairCategoryId = hair.id;
    const adminA = await prisma.user.create({
      data: {
        spaId: spaA,
        firstName: 'Admin',
        lastName: 'A',
        email: 'admin-a@integration.test',
        passwordHash,
        role: 'SPA_ADMIN',
      },
    });
    const userA = await prisma.user.create({
      data: {
        spaId: spaA,
        firstName: 'Pro',
        lastName: 'A',
        email: 'pro-a@integration.test',
        passwordHash,
        role: 'PROFESSIONAL',
      },
    });
    professionalA = (
      await prisma.professional.create({
        data: {
          spaId: spaA,
          userId: userA.id,
          displayName: 'Pro A',
          commissionRate: '25',
        },
      })
    ).id;
    bookingService = (
      await prisma.spaService.create({
        data: {
          spaId: spaA,
          name: 'Booking service',
          categoryId: nailsCategoryId,
          durationMinutes: 60,
          price: '20',
        },
      })
    ).id;
    variableService = (
      await prisma.spaService.create({
        data: {
          spaId: spaA,
          name: 'Variable booking service',
          categoryId: nailsCategoryId,
          durationType: 'VARIABLE',
          durationMinutes: null,
          priceType: 'VARIABLE',
          price: '80',
        },
      })
    ).id;
    await prisma.professionalService.create({
      data: {
        spaId: spaA,
        professionalId: professionalA,
        serviceId: bookingService,
      },
    });
    await prisma.professionalService.create({
      data: {
        spaId: spaA,
        professionalId: professionalA,
        serviceId: variableService,
      },
    });
    await prisma.professionalSchedule.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        spaId: spaA,
        professionalId: professionalA,
        dayOfWeek,
        startMinute: 540,
        endMinute: 1080,
      })),
    });
    await prisma.user.create({
      data: {
        spaId: spaB,
        firstName: 'Admin',
        lastName: 'B',
        email: 'admin-b@integration.test',
        passwordHash,
        role: 'SPA_ADMIN',
      },
    });
    const userB = await prisma.user.create({
      data: {
        spaId: spaB,
        firstName: 'Pro',
        lastName: 'B',
        email: 'pro-b@integration.test',
        passwordHash,
        role: 'PROFESSIONAL',
      },
    });
    professionalB = (
      await prisma.professional.create({
        data: {
          spaId: spaB,
          userId: userB.id,
          displayName: 'Pro B',
          commissionRate: '25',
        },
      })
    ).id;
    expect(adminA.id).toBeDefined();
  });
  afterAll(async () => {
    await app.close();
  });
  async function login(email: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Integration-Password-2026' })
      .expect(201);
    return response.body as { accessToken: string; refreshToken: string };
  }
  it('rejects unauthenticated private requests', () =>
    request(app.getHttpServer()).get('/api/v1/spa').expect(401));
  it('isolates reads and updates across tenants', async () => {
    const auth = await login('admin-a@integration.test');
    await request(app.getHttpServer())
      .get(`/api/v1/spa/professionals/${professionalB}`)
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/spa/professionals/${professionalB}`)
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ commissionRate: '99' })
      .expect(404);
  });
  it('rotates refresh tokens and detects reuse', async () => {
    const auth = await login('admin-a@integration.test');
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: auth.refreshToken })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: auth.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });
  it('database constraints reject cross-tenant service assignments', async () => {
    const serviceA = await prisma.spaService.create({
      data: {
        spaId: spaA,
        name: 'Service A',
        categoryId: nailsCategoryId,
        durationMinutes: 30,
        price: '10',
      },
    });
    await expect(
      prisma.professionalService.create({
        data: {
          spaId: spaA,
          professionalId: professionalB,
          serviceId: serviceA.id,
        },
      }),
    ).rejects.toBeDefined();
  });
  it('rejects appointments outside spa operating hours', async () => {
    bookingAccessToken = (await login('admin-a@integration.test')).accessToken;
    const outsideOpening = DateTime.now()
      .setZone('America/Caracas')
      .plus({ days: 2 })
      .startOf('day')
      .plus({ hours: 8, minutes: 30 });
    await request(app.getHttpServer())
      .post('/api/v1/spa/appointments')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({
        serviceId: bookingService,
        professionalId: professionalA,
        startAt: outsideOpening.toISO(),
        customerName: 'Outside Hours',
        customerNationalId: '12345670',
        customerPhone: '+58000000000',
      })
      .expect(409);
  });
  it('rejects invalid intervals and inactive professionals', async () => {
    const base = DateTime.now()
      .setZone('America/Caracas')
      .plus({ days: 4 })
      .startOf('day')
      .plus({ hours: 10 });
    const payload = {
      serviceId: bookingService,
      professionalId: professionalA,
      customerName: 'Validation Client',
      customerNationalId: '12345670',
      customerPhone: '+58000000000',
    };
    await request(app.getHttpServer())
      .post('/api/v1/spa/appointments')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({ ...payload, startAt: base.plus({ minutes: 15 }).toISO() })
      .expect(400);
    await prisma.professional.update({
      where: { id: professionalA },
      data: { isActive: false },
    });
    await request(app.getHttpServer())
      .post('/api/v1/spa/appointments')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({ ...payload, startAt: base.toISO() })
      .expect(409);
    await prisma.professional.update({
      where: { id: professionalA },
      data: { isActive: true },
    });
  });
  it('rejects appointments outside the professional schedule', async () => {
    const start = DateTime.now()
      .setZone('America/Caracas')
      .plus({ days: 5 })
      .startOf('day')
      .plus({ hours: 10 });
    const dayOfWeek = start.weekday % 7;
    await prisma.professionalSchedule.updateMany({
      where: { professionalId: professionalA, dayOfWeek },
      data: { isActive: false },
    });
    await request(app.getHttpServer())
      .post('/api/v1/spa/appointments')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({
        serviceId: bookingService,
        professionalId: professionalA,
        startAt: start.toISO(),
        customerName: 'No Schedule',
        customerNationalId: '12345670',
        customerPhone: '+58000000000',
      })
      .expect(409);
    await prisma.professionalSchedule.updateMany({
      where: { professionalId: professionalA, dayOfWeek },
      data: { isActive: true },
    });
  });
  it('allows only one of two concurrent requests for the same slot', async () => {
    const startAt = DateTime.now()
      .setZone('America/Caracas')
      .plus({ days: 3 })
      .startOf('day')
      .plus({ hours: 10 })
      .toISO();
    const payload = {
      serviceId: bookingService,
      professionalId: professionalA,
      startAt,
      customerName: 'Concurrent Client',
      customerNationalId: '12345670',
      customerPhone: '+58000000000',
    };
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/spa/appointments')
        .set('Authorization', `Bearer ${bookingAccessToken}`)
        .send(payload),
      request(app.getHttpServer())
        .post('/api/v1/spa/appointments')
        .set('Authorization', `Bearer ${bookingAccessToken}`)
        .send(payload),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(
      await prisma.appointment.count({
        where: { professionalId: professionalA, startAt: new Date(startAt!) },
      }),
    ).toBe(1);
  });
  it('rejects completing an appointment before its end time', async () => {
    const startAt = DateTime.now()
      .setZone('America/Caracas')
      .plus({ days: 6 })
      .startOf('day')
      .plus({ hours: 14 })
      .toISO();
    const created = await request(app.getHttpServer())
      .post('/api/v1/spa/appointments')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({
        serviceId: bookingService,
        professionalId: professionalA,
        startAt,
        customerName: 'Future Client',
        customerNationalId: '12345671',
        customerPhone: '+58000000001',
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/spa/appointments/${created.body.id}`)
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({ status: 'COMPLETED' })
      .expect(409);
    const stored = await prisma.appointment.findUniqueOrThrow({
      where: { id: created.body.id as string },
    });
    expect(stored.status).toBe('CONFIRMED');
  });
  it('rejects rescheduling outside exact intervals or operating hours', async () => {
    const customer = await prisma.customer.findFirstOrThrow({
      where: { spaId: spaA, nationalId: '12345671' },
    });
    const appointment = await prisma.appointment.findFirstOrThrow({
      where: { spaId: spaA, customerId: customer.id },
    });
    const localDay = DateTime.now()
      .setZone('America/Caracas')
      .plus({ days: 9 })
      .startOf('day');
    await request(app.getHttpServer())
      .patch(`/api/v1/spa/appointments/${appointment.id}`)
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({ startAt: localDay.plus({ hours: 14, seconds: 15 }).toISO() })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/spa/appointments/${appointment.id}`)
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({ startAt: localDay.plus({ hours: 17, minutes: 30 }).toISO() })
      .expect(409);
  });
  it('reuses an existing customer and exposes customer history', async () => {
    const customer = await prisma.customer.findFirstOrThrow({
      where: { spaId: spaA, nationalId: '12345671' },
    });
    const startAt = DateTime.now()
      .setZone('America/Caracas')
      .plus({ days: 8 })
      .startOf('day')
      .plus({ hours: 14 })
      .toISO();
    await request(app.getHttpServer())
      .post('/api/v1/spa/appointments')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({
        serviceId: bookingService,
        professionalId: professionalA,
        customerId: customer.id,
        startAt,
      })
      .expect(201);
    const search = await request(app.getHttpServer())
      .get('/api/v1/spa/customers?search=Future&period=all')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .expect(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0]._count.appointments).toBe(0);
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/spa/customers/${customer.id}`)
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .expect(200);
    expect(detail.body.appointments).toHaveLength(2);
    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/spa/customers/${customer.id}`)
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({ name: 'Future Client Updated', phone: '04120000001' })
      .expect(200);
    expect(updated.body.name).toBe('Future Client Updated');
    expect(updated.body.nationalId).toBe('12345671');
  });
  it('allows different categories but rejects the same category on one day', async () => {
    const hairService = await prisma.spaService.create({
      data: {
        spaId: spaA,
        name: 'Hair category service',
        categoryId: hairCategoryId,
        durationMinutes: 60,
        price: '30',
      },
    });
    await prisma.professionalService.create({
      data: {
        spaId: spaA,
        professionalId: professionalA,
        serviceId: hairService.id,
      },
    });
    const day = DateTime.now()
      .setZone('America/Caracas')
      .plus({ days: 11 })
      .startOf('day');
    const first = await request(app.getHttpServer())
      .post('/api/v1/spa/appointments')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({
        serviceId: bookingService,
        professionalId: professionalA,
        startAt: day.plus({ hours: 9 }).toISO(),
        customerName: 'Category Client',
        customerNationalId: '12345673',
        customerPhone: '+58000000003',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/spa/appointments')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({
        serviceId: bookingService,
        professionalId: professionalA,
        customerId: first.body.customerId,
        startAt: day.plus({ hours: 11 }).toISO(),
      })
      .expect(409);

    await request(app.getHttpServer())
      .post('/api/v1/spa/appointments')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({
        serviceId: hairService.id,
        professionalId: professionalA,
        customerId: first.body.customerId,
        startAt: day.plus({ hours: 12 }).toISO(),
      })
      .expect(201);
  });
  it('creates an ordered multi-service appointment atomically', async () => {
    const hairService = await prisma.spaService.findFirstOrThrow({
      where: { spaId: spaA, categoryId: hairCategoryId },
    });
    const date = DateTime.now()
      .setZone('America/Caracas')
      .plus({ days: 12 })
      .toISODate()!;
    const items = [
      { serviceId: bookingService, professionalId: professionalA },
      { serviceId: hairService.id, professionalId: professionalA },
    ];
    const availability = await request(app.getHttpServer())
      .post('/api/v1/spa/appointments/bundle/availability')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({ date, intervalMinutes: 30, items })
      .expect(201);
    expect(availability.body.data.length).toBeGreaterThan(0);
    const plan = availability.body.data[0];
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[1].start).toBe(plan.segments[0].end);

    const created = await request(app.getHttpServer())
      .post('/api/v1/spa/appointments/bundle')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({
        startAt: plan.start,
        items,
        customerName: 'Bundle Client',
        customerNationalId: '12345674',
        customerPhone: '+58000000004',
      })
      .expect(201);
    expect(created.body).toHaveLength(2);
    expect(created.body[1].startAt).toBe(created.body[0].endAt);
  });
  it('deletes a customer without completed services and their pending appointments', async () => {
    const customer = await prisma.customer.findFirstOrThrow({
      where: { spaId: spaA, nationalId: '12345671' },
    });
    const completed = await prisma.appointment.findFirstOrThrow({
      where: { customerId: customer.id },
    });
    await prisma.appointment.update({
      where: { id: completed.id },
      data: { status: 'COMPLETED' },
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/spa/customers/${customer.id}`)
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .expect(409);
    await prisma.appointment.update({
      where: { id: completed.id },
      data: { status: 'CONFIRMED' },
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/spa/customers/${customer.id}`)
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .expect(200)
      .expect({ success: true });
    expect(
      await prisma.customer.findUnique({ where: { id: customer.id } }),
    ).toBeNull();
    expect(
      await prisma.appointment.count({ where: { customerId: customer.id } }),
    ).toBe(0);
  });
  it('returns a conflict when a service is renamed to an existing name', async () => {
    const variable = await prisma.spaService.findUniqueOrThrow({
      where: { id: variableService },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/spa/services/${bookingService}`)
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({ name: variable.name })
      .expect(409);
  });
  it('requires and applies a selected duration for variable services', async () => {
    const start = DateTime.now()
      .setZone('America/Caracas')
      .plus({ days: 7 })
      .startOf('day')
      .plus({ hours: 9 });
    const date = start.toISODate();
    await request(app.getHttpServer())
      .get(
        `/api/v1/spa/availability?date=${date}&serviceId=${variableService}&intervalMinutes=30`,
      )
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .expect(400);
    const availability = await request(app.getHttpServer())
      .get(
        `/api/v1/spa/availability?date=${date}&serviceId=${variableService}&durationMinutes=300&intervalMinutes=30`,
      )
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .expect(200);
    expect(availability.body.durationMinutes).toBe(300);
    const slot = availability.body.data.find(
      (item: { start: string }) => item.start === start.toUTC().toISO(),
    );
    expect(slot).toBeDefined();
    const bookingPayload = {
      serviceId: variableService,
      professionalId: professionalA,
      startAt: slot.start,
      durationMinutes: 300,
      customerName: 'Variable Duration',
      customerNationalId: '12345672',
      customerPhone: '+58000000002',
    };
    await request(app.getHttpServer())
      .post('/api/v1/spa/appointments')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send(bookingPayload)
      .expect(400);
    const created = await request(app.getHttpServer())
      .post('/api/v1/spa/appointments')
      .set('Authorization', `Bearer ${bookingAccessToken}`)
      .send({
        ...bookingPayload,
        additionalPrice: '25.50',
      })
      .expect(201);
    expect(
      (new Date(created.body.endAt).getTime() -
        new Date(created.body.startAt).getTime()) /
        60000,
    ).toBe(300);
    expect(Number(created.body.servicePrice)).toBe(105.5);
  });
});
