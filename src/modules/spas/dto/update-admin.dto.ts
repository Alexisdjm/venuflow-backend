import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsMailboxProvider } from '../../../common/validation/mailbox-provider';

export class UpdateAdminDto {
  @IsString() @MinLength(2) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(2) @MaxLength(80) lastName!: string;
  @IsEmail() @IsMailboxProvider() email!: string;
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password?: string;
}
