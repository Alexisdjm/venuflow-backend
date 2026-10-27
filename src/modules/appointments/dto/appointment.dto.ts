import {
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Max,
  Min,
  MinLength,
  IsDivisibleBy,
  IsDecimal,
  ValidateIf,
} from 'class-validator';
export class ListAppointmentsDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @IsIn(['CONFIRMED', 'COMPLETED', 'CANCELLED']) status?:
    'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
}
export class CreateAppointmentDto {
  @IsUUID() serviceId!: string;
  @IsOptional() @IsUUID() professionalId?: string;
  @IsISO8601({ strict: true }) startAt!: string;
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(720)
  @IsDivisibleBy(30)
  durationMinutes?: number;
  @IsOptional() @IsDecimal({ decimal_digits: '0,2' }) additionalPrice?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @ValidateIf((dto: CreateAppointmentDto) => !dto.customerId)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  customerName?: string;
  @ValidateIf((dto: CreateAppointmentDto) => !dto.customerId)
  @Matches(/^\d{7,8}$/)
  customerNationalId?: string;
  @ValidateIf((dto: CreateAppointmentDto) => !dto.customerId)
  @IsString()
  @MinLength(5)
  @MaxLength(40)
  customerPhone?: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class UpdateAppointmentDto {
  @IsOptional() @IsIn(['CONFIRMED', 'COMPLETED', 'CANCELLED']) status?:
    'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  @IsOptional() @IsISO8601({ strict: true }) startAt?: string;
  @IsOptional() @IsUUID() professionalId?: string;
  @IsOptional() @IsIn([30]) delayMinutes?: 30;
}

export class VisitAvailabilityQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
}
