import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class PublicCustomerDto {
  @IsString({ message: 'Escribe tu nombre completo.' })
  @MinLength(2, { message: 'Escribe tu nombre completo.' })
  @MaxLength(120)
  name!: string;

  @Matches(/^\d{7,8}$/, { message: 'La cédula debe tener 7 u 8 dígitos.' })
  nationalId!: string;

  @IsEmail({}, { message: 'Escribe un correo válido.' })
  email!: string;

  @IsString()
  @MinLength(7, { message: 'Usa un teléfono válido.' })
  @MaxLength(40)
  phone!: string;
}

export class CreatePublicBookingDto {
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Spa no encontrado' })
  spaSlug!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Selecciona un servicio.' })
  @ArrayMaxSize(1, {
    message: 'La reserva en línea confirma un servicio a la vez.',
  })
  @IsUUID('4', { each: true })
  serviceIds!: string[];

  @IsOptional()
  @ValidateIf((_, value) => value !== undefined && value !== 'any')
  @IsUUID('4', { message: 'Selecciona una profesional válida.' })
  professionalId?: string;

  @IsISO8601({ strict: true }, { message: 'Selecciona un horario válido.' })
  start!: string;

  @ValidateNested()
  @Type(() => PublicCustomerDto)
  customer!: PublicCustomerDto;
}
