import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CustomerQueryDto extends PaginationDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(['all', 'day', 'week', 'month']) period:
    'all' | 'day' | 'week' | 'month' = 'all';
}
