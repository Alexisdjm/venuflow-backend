import { IsIn, IsOptional, Matches } from 'class-validator';

export class RevenueQueryDto {
  @IsOptional() @IsIn(['day', 'week', 'month']) period:
    'day' | 'week' | 'month' = 'day';
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
}
