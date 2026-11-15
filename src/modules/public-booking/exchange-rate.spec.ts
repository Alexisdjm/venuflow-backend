import { Prisma } from '../../generated/prisma/client';
import { exchangeKind, readBinanceRate, readOfficialRate, vesFromRate } from './exchange-rate';

describe('exchange rates', () => {
  it('uses the BCV rate for bolivar transfers and Binance for USDT', () => {
    expect(exchangeKind('PAGO_MOVIL', 'USD')).toEqual({ source: 'BCV', pair: 'USD/VES' });
    expect(exchangeKind('TRANSFER', 'EUR')).toEqual({ source: 'BCV', pair: 'EUR/VES' });
    expect(exchangeKind('BINANCE', 'USD')).toEqual({ source: 'BINANCE', pair: 'USDT/VES' });
    expect(exchangeKind('PAGO_MOVIL', 'USDT')).toEqual({ source: 'BINANCE', pair: 'USDT/VES' });
    expect(exchangeKind('ZELLE', 'USD')).toBeNull();
    expect(exchangeKind('PAYPAL', 'EUR')).toBeNull();
    expect(exchangeKind('PAGO_MOVIL', 'VES')).toBeNull();
  });

  it('rounds the bolivar amount to cents', () => {
    expect(vesFromRate('7.50', '911.6243').toFixed(2)).toBe('6837.18');
  });

  it('reads the official average and the Binance quote', () => {
    expect(readOfficialRate({ promedio: 911.6243, fechaActualizacion: '2026-11-13T00:00:00-04:00' }).rate).toEqual(new Prisma.Decimal('911.6243'));
    expect(readBinanceRate({ success: true, data: { price: 1055.54 } }, new Date('2026-11-15T12:00:00.000Z')).rate).toEqual(new Prisma.Decimal('1055.54'));
    expect(() => readOfficialRate({ promedio: null })).toThrow();
    expect(() => readBinanceRate({ success: false, data: { price: 1 } })).toThrow();
  });
});
