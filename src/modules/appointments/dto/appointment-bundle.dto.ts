import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDecimal,
  IsDivisibleBy,
  IsEmail,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class AppointmentBundleItemDto {
  @IsUUID() serviceId!: string;
  @IsOptional() @IsUUID() professionalId?: string;
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(720)
  @IsDivisibleBy(30)
  durationMinutes?: number;
  @IsOptional() @IsDecimal({ decimal_digits: '0,2' }) additionalPrice?: string;
}

export class BundleAvailabilityDto {
  @IsDateString({ strict: true }) date!: string;
  @IsOptional() @IsInt() @Min(30) @Max(60) @IsDivisibleBy(30) intervalMinutes =
    30;
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => AppointmentBundleItemDto)
  items!: AppointmentBundleItemDto[];
}

export class CreateAppointmentBundleDto {
  @IsISO8601({ strict: true }) startAt!: string;
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => AppointmentBundleItemDto)
  items!: AppointmentBundleItemDto[];
  @IsOptional() @IsUUID() customerId?: string;
  @ValidateIf((dto: CreateAppointmentBundleDto) => !dto.customerId)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  customerName?: string;
  @ValidateIf((dto: CreateAppointmentBundleDto) => !dto.customerId)
  @Matches(/^\d{7,8}$/)
  customerNationalId?: string;
  @ValidateIf((dto: CreateAppointmentBundleDto) => !dto.customerId)
  @IsString()
  @MinLength(5)
  @MaxLength(40)
  customerPhone?: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
