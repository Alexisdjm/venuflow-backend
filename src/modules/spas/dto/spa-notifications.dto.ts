import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PAYOUT_CADENCES } from '../spa-notifications';

export class UpdatePayoutCadenceDto {
  @ApiProperty({ enum: PAYOUT_CADENCES })
  @IsIn(PAYOUT_CADENCES)
  cadence!: (typeof PAYOUT_CADENCES)[number];
}
