import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsIn(['development', 'test', 'production']) NODE_ENV = 'development';
  @Type(() => Number)
  @IsInt()
  @Min(1)
  PORT = 3000;
  @IsUrl({ require_tld: false, protocols: ['postgresql'] })
  DATABASE_URL!: string;
  @IsString() @MinLength(32) JWT_ACCESS_SECRET!: string;
  @Transform(({ value }) => blankToUndefined(value))
  @IsOptional()
  @IsIn(['local', 'staging', 'production'])
  VENUEFLOW_ENV?: string;
  @Transform(({ value }) => blankToUndefined(value))
  @IsOptional()
  @IsString()
  @MinLength(32)
  PUBLIC_BOOKING_TOKEN_SECRET?: string;
  @IsString() JWT_ACCESS_EXPIRES_IN = '15m';
  @Type(() => Number)
  @IsInt()
  @Min(1)
  REFRESH_TOKEN_EXPIRES_DAYS = 30;
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  SWAGGER_ENABLED = true;
  /** One trusted reverse-proxy hop. Leave false until that proxy overwrites X-Forwarded-For. */
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  TRUST_PROXY = false;
  @IsString() CORS_ORIGINS = 'http://localhost:3001';
  @Transform(({ value }) => blankToUndefined(value))
  @IsOptional()
  @IsString()
  BREVO_API_KEY?: string;
  @Transform(({ value }) => blankToUndefined(value))
  @IsOptional()
  @IsEmail()
  BREVO_SENDER_EMAIL?: string;
  @Transform(({ value }) => blankToUndefined(value))
  @IsOptional()
  @IsString()
  BREVO_SENDER_NAME?: string;
  @Transform(({ value }) => blankToUndefined(value) ?? 'http://localhost:3002')
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  PUBLIC_BOOKING_BASE_URL = 'http://localhost:3002';
  /** Hostname only, for example tryvenueflow.com. Each spa is served at {slug}.{domain}. */
  @Transform(({ value }) => blankToUndefined(value))
  @IsOptional()
  @Matches(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  )
  PUBLIC_BOOKING_ROOT_DOMAIN?: string;
  @Transform(({ value }) => blankToUndefined(value))
  @IsOptional()
  @IsIn(['http', 'https'])
  PUBLIC_BOOKING_PROTOCOL?: string;
  @Transform(({ value }) => blankToUndefined(value))
  @IsOptional()
  @Matches(/^\d{1,5}$/)
  PUBLIC_BOOKING_PORT?: string;
}

function blankToUndefined(value: unknown) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function validateEnvironment(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length) throw new Error(errors.toString());
  if (validated.VENUEFLOW_ENV === 'production') {
    const booking = validated.PUBLIC_BOOKING_TOKEN_SECRET;
    if (!booking || booking === validated.JWT_ACCESS_SECRET) {
      throw new Error(
        'PUBLIC_BOOKING_TOKEN_SECRET must be set and must differ from JWT_ACCESS_SECRET when VENUEFLOW_ENV=production',
      );
    }
  }
  return validated;
}
