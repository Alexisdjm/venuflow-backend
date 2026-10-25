import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateServiceCategoryDto {
  @IsString() @MinLength(2) @MaxLength(40) name!: string;
}

export class UpdateServiceCategoryDto {
  @IsString() @MinLength(2) @MaxLength(40) name!: string;
}
