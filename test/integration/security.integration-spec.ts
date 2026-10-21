import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma/prisma.service';

describe('PostgreSQL security integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let spaA: string, spaB: string, professionalB: string;
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
    await prisma.user.create({
      data: {
        spaId: spaA,
        firstName: 'Admin',
        lastName: 'A',
        email: 'admin-a@integration.test',
        passwordHash,
        role: 'SPA_ADMIN',
      },
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
});
