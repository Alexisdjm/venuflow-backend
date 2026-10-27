import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class PublicSequenceItemDto {
  @IsUUID('4', { message: 'Selecciona un servicio válido.' })
  serviceId!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== undefined && value !== 'any')
  @IsUUID('4', { message: 'Selecciona una profesional válida.' })
  professionalId?: string;
}

export class PublicSequenceAvailabilityDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Selecciona una fecha válida.' })
  date!: string;

  @IsBoolean()
  sameProfessional!: boolean;

  @IsArray()
  @ArrayMinSize(2, { message: 'Elige al menos dos servicios.' })
  @ArrayMaxSize(5, { message: 'Puedes reservar hasta 5 servicios.' })
  @ValidateNested({ each: true })
  @Type(() => PublicSequenceItemDto)
  items!: PublicSequenceItemDto[];
}
