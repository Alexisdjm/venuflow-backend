import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDecimal,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
export class CreateProfessionalDto {
  @IsString() @MinLength(2) firstName!: string;
  @IsString() @MinLength(2) lastName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
  @IsString() @MinLength(2) displayName!: string;
  @IsDecimal({ decimal_digits: '0,2' }) commissionRate!: string;
}
export class CreateOwnProfessionalDto {
  @IsString() @MinLength(2) displayName!: string;
  @IsDecimal({ decimal_digits: '0,2' }) commissionRate!: string;
}
export class ResetProfessionalPasswordDto {
  @IsString()
  @MinLength(12, { message: 'La nueva contraseña debe tener al menos 12 caracteres.' })
  @MaxLength(128)
  password!: string;
}
export class UpdateProfessionalDto {
  @IsOptional() @IsString() @MinLength(2) displayName?: string;
  @IsOptional() @IsDecimal({ decimal_digits: '0,2' }) commissionRate?: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;
}
