import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Security and validation (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_ACCESS_SECRET =
      'test-secret-with-at-least-thirty-two-characters';
    process.env.SWAGGER_ENABLED = 'false';
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
  });
  afterAll(() => app.close());
  it('rejects unauthenticated private access', () =>
    request(app.getHttpServer()).get('/api/v1/spa').expect(401));
  it('rejects unknown login properties', () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'bad', password: 'short', role: 'PLATFORM_ADMIN' })
      .expect(400));
});
