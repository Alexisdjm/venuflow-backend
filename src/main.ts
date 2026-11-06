import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { spanishValidationException } from './common/validation/spanish-validation';
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  if (config.get('TRUST_PROXY') === true) app.set('trust proxy', 1);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({
    origin: config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((x) => x.trim()),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: spanishValidationException,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  if (
    config.get('SWAGGER_ENABLED') &&
    config.get('NODE_ENV') !== 'production'
  ) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('VenueFlow API')
        .setVersion('1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  if (process.env.VENUEFLOW_RUNTIME === 'staging') {
    const databaseUrl = new URL(config.getOrThrow<string>('DATABASE_URL'));
    const database = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
    new Logger('VenueFlow').log(
      `STAGING host=${databaseUrl.hostname} port=${databaseUrl.port || '5432'} database=${database} sslmode=${databaseUrl.searchParams.get('sslmode') ?? 'unset'} listen=${port}`,
    );
  }
}
void bootstrap();
