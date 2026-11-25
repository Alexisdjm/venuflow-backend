import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDivisibleBy,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { IsMailboxProvider } from '../../../common/validation/mailbox-provider';
import { isPublicSpaSlug } from '../../../common/public-booking-url';
import { DEFAULT_SERVICE_CATEGORIES } from '../../services/default-categories';
import { SPA_KINDS } from '../../spas/business-kind';
import { TRIAL_PLACES } from '../trial-places';

const placeCodes = TRIAL_PLACES.map((place) => place.code);

@ValidatorConstraint({ name: 'trialPublicSlug', async: false })
class PublicSlugConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isPublicSpaSlug(value);
  }
  defaultMessage() {
    return 'Ese identificador no puede usarse como dirección pública';
  }
}

export class TrialServiceDto {
  @IsString()
  @MinLength(2, { message: 'El servicio necesita un nombre.' })
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsIn(DEFAULT_SERVICE_CATEGORIES, {
    message: 'Elige una categoría de la lista.',
  })
  category?: (typeof DEFAULT_SERVICE_CATEGORIES)[number];

  @IsInt()
  @Min(30, { message: 'La duración mínima es 30 minutos.' })
  @Max(180, { message: 'La duración máxima en la prueba es 180 minutos.' })
  @IsDivisibleBy(30, { message: 'La duración debe ser de 30 en 30 minutos.' })
  durationMinutes!: number;

  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio admite hasta dos decimales.' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor que cero.' })
  @Max(100000)
  price!: number;
}

export class TrialProfessionalDto {
  @IsString()
  @MinLength(2, { message: 'Escribe el nombre de quien atiende.' })
  @MaxLength(80)
  name!: string;

  @IsEmail({}, { message: 'Escribe un correo con formato válido.' })
  @IsMailboxProvider()
  email!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @Matches(/^\d{10,15}$/, { message: 'Usa un teléfono de 10 a 15 dígitos.' })
  phone!: string;
}

export class CreateTrialDto {
  @IsString()
  @MinLength(2, { message: 'Escribe el nombre del spa.' })
  @MaxLength(120)
  spaName!: string;

  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'La dirección solo puede usar letras minúsculas, números y guiones.',
  })
  @MaxLength(48)
  @Validate(PublicSlugConstraint)
  slug!: string;

  @IsIn(placeCodes, { message: 'Elige el país del spa.' })
  country!: (typeof TRIAL_PLACES)[number]['code'];

  @IsIn(SPA_KINDS, { message: 'Elige el tipo de negocio.' })
  kind!: (typeof SPA_KINDS)[number];

  @IsString()
  @MinLength(2, { message: 'Escribe el nombre.' })
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(2, { message: 'Escribe el apellido.' })
  @MaxLength(80)
  lastName!: string;

  @IsEmail({}, { message: 'Escribe un correo con formato válido.' })
  @IsMailboxProvider()
  email!: string;

  @IsString()
  @MinLength(12, {
    message: 'La contraseña debe tener al menos 12 caracteres.',
  })
  @MaxLength(128)
  password!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @Matches(/^\d{10,15}$/, { message: 'Usa un teléfono de 10 a 15 dígitos.' })
  phone!: string;

  @IsBoolean()
  ownerProvidesService!: boolean;

  @IsOptional()
  @ArrayMaxSize(30, {
    message: 'En la prueba puedes agregar hasta 30 profesionales.',
  })
  @ValidateNested({ each: true })
  @Type(() => TrialProfessionalDto)
  extraProfessionals?: TrialProfessionalDto[];

  @ArrayMinSize(1, { message: 'Deja al menos un servicio.' })
  @ArrayMaxSize(2, {
    message: 'En la prueba puedes empezar con dos servicios.',
  })
  @ValidateNested({ each: true })
  @Type(() => TrialServiceDto)
  services!: TrialServiceDto[];
}
