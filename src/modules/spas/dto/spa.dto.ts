import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsIn,
  IsString,
  IsTimeZone,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SpaStatus } from '../../../generated/prisma/enums';
export class CreateSpaDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiProperty({ example: 'spa-caracas' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;
  @ApiProperty({ example: 'America/Caracas' }) @IsTimeZone() timezone!: string;
  @ApiProperty({ example: 'USD' })
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}
export class UpdateSpaDto extends PartialType(CreateSpaDto) {
  @ApiProperty({ enum: SpaStatus, required: false })
  @IsIn(Object.values(SpaStatus))
  status?: SpaStatus;
}
