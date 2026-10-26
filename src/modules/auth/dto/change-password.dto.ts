import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(12, { message: 'La nueva contraseña debe tener al menos 12 caracteres.' })
  @MaxLength(128)
  newPassword!: string;
}
