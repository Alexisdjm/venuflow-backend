import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
export class AvailabilityQueryDto {
  @IsDateString({ strict: true }) date!: string;
  @IsUUID() serviceId!: string;
  @IsOptional() @IsUUID() professionalId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(60) intervalMinutes =
    15;
}
