import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
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
import { PublicSequenceItemDto } from './public-sequence.dto';

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

export class PublicPaymentProofDto {
  @IsIn(['image/jpeg', 'image/png', 'image/webp'], { message: 'La captura debe ser JPG, PNG o WebP.' })
  mime!: 'image/jpeg' | 'image/png' | 'image/webp';

  @IsString()
  @MaxLength(2_100_000, { message: 'La captura es demasiado grande.' })
  data!: string;
}

export class PublicPagoMovilSenderDto {
  @Matches(/^\d{7,8}$/, { message: 'La cédula debe tener 7 u 8 dígitos.' })
  nationalId!: string;

  @Matches(/^\d{10,15}$/, { message: 'Usa el teléfono del pago móvil.' })
  phone!: string;

  @IsString({ message: 'Elige el banco desde el que pagaste.' })
  @MinLength(7, { message: 'Elige el banco desde el que pagaste.' })
  @MaxLength(80, { message: 'Elige el banco desde el que pagaste.' })
  bank!: string;
}

export class PublicPaymentDto {
  @IsUUID('4', { message: 'Elige un método de pago.' })
  methodId!: string;

  @IsString()
  @MinLength(4, { message: 'La referencia debe tener entre 4 y 40 caracteres.' })
  @MaxLength(40, { message: 'La referencia debe tener entre 4 y 40 caracteres.' })
  reference!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PublicPagoMovilSenderDto)
  pagoMovil?: PublicPagoMovilSenderDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PublicPaymentProofDto)
  proof?: PublicPaymentProofDto;
}

export class CreatePublicBookingDto {
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Spa no encontrado' })
  spaSlug!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Selecciona un servicio.' })
  @ArrayMaxSize(5, { message: 'Puedes reservar hasta 5 servicios.' })
  @IsUUID('4', { each: true })
  serviceIds!: string[];

  @IsOptional()
  @IsBoolean()
  sameProfessional?: boolean;

  @ValidateIf((dto: CreatePublicBookingDto) => dto.serviceIds.length > 1)
  @IsArray()
  @ArrayMinSize(2, { message: 'Elige al menos dos servicios.' })
  @ArrayMaxSize(5, { message: 'Puedes reservar hasta 5 servicios.' })
  @ValidateNested({ each: true })
  @Type(() => PublicSequenceItemDto)
  items?: PublicSequenceItemDto[];

  @IsOptional()
  @ValidateIf((_, value) => value !== undefined && value !== 'any')
  @IsUUID('4', { message: 'Selecciona una profesional válida.' })
  professionalId?: string;

  @IsISO8601({ strict: true }, { message: 'Selecciona un horario válido.' })
  start!: string;

  @ValidateNested()
  @Type(() => PublicCustomerDto)
  customer!: PublicCustomerDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PublicPaymentDto)
  payment?: PublicPaymentDto;
}
