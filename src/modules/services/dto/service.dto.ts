import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDecimal,
  IsDivisibleBy,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateServiceDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsUUID() categoryId!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsIn(['FIXED', 'VARIABLE']) durationType?:
    'FIXED' | 'VARIABLE';
  @ValidateIf((dto: CreateServiceDto) => dto.durationType !== 'VARIABLE')
  @IsInt()
  @Min(30)
  @Max(720)
  @IsDivisibleBy(30)
  durationMinutes?: number;
  @IsOptional() @IsIn(['FIXED', 'VARIABLE']) priceType?: 'FIXED' | 'VARIABLE';
  @IsOptional() @IsIn(['SINGLE', 'PACKAGE']) offering?: 'SINGLE' | 'PACKAGE';
  @IsOptional() @IsIn([10, 15, 18, 21]) validityDays?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) defaultSessionsPerWeek?: number | null;
  @IsDecimal({ decimal_digits: '0,2' }) price!: string;
  @IsOptional() @IsBoolean() extraCommission?: boolean;
  @ValidateIf((dto: CreateServiceDto) => dto.extraCommission === true)
  @IsDecimal({ decimal_digits: '0,2' })
  extraCommissionRate?: string;
}
export class UpdateServiceDto extends PartialType(CreateServiceDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
