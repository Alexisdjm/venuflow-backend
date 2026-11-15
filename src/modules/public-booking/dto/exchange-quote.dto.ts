import { Type } from 'class-transformer';
import { IsIn, IsNumber, Max, Min } from 'class-validator';
import { REMOTE_PAYMENT_METHODS } from '../../spas/booking-payments';
import { SPA_CURRENCIES } from '../../spas/dto/spa.dto';

export class ExchangeQuoteQueryDto {
  @IsIn(SPA_CURRENCIES, { message: 'La moneda del adelanto no es válida.' })
  currency!: (typeof SPA_CURRENCIES)[number];

  @IsIn(REMOTE_PAYMENT_METHODS, { message: 'Elige un método de pago.' })
  method!: (typeof REMOTE_PAYMENT_METHODS)[number];

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El monto admite hasta dos decimales.' })
  @Min(0.01, { message: 'El monto no es válido.' })
  @Max(100000, { message: 'El monto no es válido.' })
  amount!: number;
}
