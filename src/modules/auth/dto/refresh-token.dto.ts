import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ writeOnly: true, description: 'Opaque refresh token' })
  @IsString()
  @MinLength(40)
  refreshToken!: string;
}
