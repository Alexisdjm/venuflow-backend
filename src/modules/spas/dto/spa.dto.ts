import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsTimeZone,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { isPublicSpaSlug } from '../../../common/public-booking-url';
import { SpaStatus } from '../../../generated/prisma/enums';

@ValidatorConstraint({ name: 'publicSpaSlug', async: false })
class PublicSpaSlugConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isPublicSpaSlug(value);
  }
  defaultMessage() {
    return 'Ese identificador no puede usarse como dirección pública';
  }
}

export const SPA_CURRENCIES = ['USD', 'USDT', 'EUR', 'VES'] as const;
export const SPA_PLANS = ['BASIC', 'PLUS'] as const;

export class CreateSpaDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiProperty({ example: 'spa-caracas' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @Validate(PublicSpaSlugConstraint)
  slug!: string;
  @ApiProperty({ example: 'America/Caracas' }) @IsTimeZone() timezone!: string;
  @ApiProperty({ enum: SPA_CURRENCIES, example: 'USD' })
  @IsIn(SPA_CURRENCIES)
  currency!: (typeof SPA_CURRENCIES)[number];
  @ApiProperty({ enum: SPA_PLANS, example: 'BASIC' })
  @IsIn(SPA_PLANS)
  plan!: (typeof SPA_PLANS)[number];
}
export class UpdateSpaDto extends PartialType(CreateSpaDto) {
  @ApiProperty({ enum: SpaStatus, required: false })
  @IsIn(Object.values(SpaStatus))
  status?: SpaStatus;
  @ApiProperty({ required: false, nullable: true, minimum: 1, maximum: 31 })
  @Transform(({ value }) => {
    if (value === '' || value === null) return null;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return value;
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(31)
  billingDueDay?: number | null;
}
