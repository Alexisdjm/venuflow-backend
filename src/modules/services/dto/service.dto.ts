import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDecimal,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateServiceDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsInt() @Min(5) @Max(720) durationMinutes!: number;
  @IsDecimal({ decimal_digits: '0,2' }) price!: string;
}
export class UpdateServiceDto extends PartialType(CreateServiceDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
