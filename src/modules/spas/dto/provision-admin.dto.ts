import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
export class ProvisionAdminDto {
  @IsString() @MinLength(2) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(2) @MaxLength(80) lastName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
