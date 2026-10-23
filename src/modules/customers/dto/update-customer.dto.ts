import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @Matches(/^\d{7,8}$/) nationalId?: string;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() email?: string | null;
}
