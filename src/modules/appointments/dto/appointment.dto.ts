import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
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
  @IsString() @MinLength(2) @MaxLength(120) customerName!: string;
  @IsString() @MinLength(5) @MaxLength(40) customerPhone!: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class UpdateAppointmentDto {
  @IsOptional() @IsIn(['CONFIRMED', 'COMPLETED', 'CANCELLED']) status?:
    'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  @IsOptional() @IsISO8601({ strict: true }) startAt?: string;
  @IsOptional() @IsUUID() professionalId?: string;
}
