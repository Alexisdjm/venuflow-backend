import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
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
  @IsString() JWT_ACCESS_EXPIRES_IN = '15m';
  @Type(() => Number)
  @IsInt()
  @Min(1)
  REFRESH_TOKEN_EXPIRES_DAYS = 30;
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  SWAGGER_ENABLED = true;
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
  return validated;
}
