import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDecimal,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsMailboxProvider } from '../../../common/validation/mailbox-provider';
export class CreateProfessionalDto {
  @IsString() @MinLength(2) firstName!: string;
  @IsString() @MinLength(2) lastName!: string;
  @IsEmail() @IsMailboxProvider() email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
  @IsString() @MinLength(2) displayName!: string;
  @Matches(/^\d{10,15}$/) phone!: string;
  @IsString() @MinLength(2) @MaxLength(200) address!: string;
  @IsDecimal({ decimal_digits: '0,2' }) commissionRate!: string;
}
export class CreateOwnProfessionalDto {
  @IsString() @MinLength(2) displayName!: string;
  @Matches(/^\d{10,15}$/) phone!: string;
  @IsString() @MinLength(2) @MaxLength(200) address!: string;
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
  @IsOptional() @Matches(/^\d{10,15}$/) phone?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) address?: string;
  @IsOptional() @IsDecimal({ decimal_digits: '0,2' }) commissionRate?: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;
}
