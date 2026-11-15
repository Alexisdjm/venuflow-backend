import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { SPA_CURRENCIES } from './spa.dto';
import { REMOTE_DEPOSIT_MODES, REMOTE_PAYMENT_METHODS } from '../booking-payments';

export class UpdateBookingPaymentsDto {
  @ApiProperty({ enum: REMOTE_DEPOSIT_MODES })
  @IsIn(REMOTE_DEPOSIT_MODES)
  mode!: (typeof REMOTE_DEPOSIT_MODES)[number];

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  value?: number | null;

  @ApiPropertyOptional({ enum: SPA_CURRENCIES, nullable: true })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsIn(SPA_CURRENCIES)
  currency?: (typeof SPA_CURRENCIES)[number] | null;

  @ApiPropertyOptional({ minimum: 60, maximum: 1440 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(1440)
  holdMinutes?: number;
}

export class CreatePaymentMethodDto {
  @ApiProperty({ enum: REMOTE_PAYMENT_METHODS })
  @IsIn(REMOTE_PAYMENT_METHODS)
  type!: (typeof REMOTE_PAYMENT_METHODS)[number];

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  label!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  details!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresProof?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  sortOrder?: number;
}

export class UpdatePaymentMethodDto {
  @ApiPropertyOptional({ enum: REMOTE_PAYMENT_METHODS })
  @IsOptional()
  @IsIn(REMOTE_PAYMENT_METHODS)
  type?: (typeof REMOTE_PAYMENT_METHODS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresProof?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  sortOrder?: number;
}
