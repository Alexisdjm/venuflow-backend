import { IsEmail, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
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
  @IsIn(['CONFIRMED', 'COMPLETED', 'CANCELLED']) status!: 'CONFIRMED'|'COMPLETED'|'CANCELLED';
}
