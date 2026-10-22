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
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.professionalSchedule.deleteMany();
    await prisma.professionalService.deleteMany();
    await prisma.spaService.deleteMany();
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
          durationMinutes: 60,
          price: '20',
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
        customerPhone: '+58000000000',
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
});
