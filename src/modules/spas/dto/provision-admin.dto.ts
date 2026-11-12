import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsMailboxProvider } from '../../../common/validation/mailbox-provider';
export class ProvisionAdminDto {
  @IsString() @MinLength(2) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(2) @MaxLength(80) lastName!: string;
  @IsEmail() @IsMailboxProvider() email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
