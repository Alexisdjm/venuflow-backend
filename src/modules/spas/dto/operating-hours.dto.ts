import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateOperatingHoursDto {
  @IsInt()
  @Min(0)
  @Max(1439)
  openingMinute!: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  closingMinute!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  walkInGraceMinutes?: number;
}
