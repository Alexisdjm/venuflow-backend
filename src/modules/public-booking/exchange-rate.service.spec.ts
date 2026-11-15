import { ExchangeRateService } from './exchange-rate.service';

const config = { get: () => undefined };

describe('ExchangeRateService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('converts a mobile payment with the official dollar and leaves Zelle in dollars', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ promedio: 100, fechaActualizacion: '2026-11-15T00:00:00-04:00' }),
    } as Response);
    const rates = new ExchangeRateService(config as never);
    await expect(rates.quote({ method: 'PAGO_MOVIL', currency: 'USD', amount: 7.5 })).resolves.toMatchObject({
      applicable: true,
      vesAmount: 750,
      source: 'BCV',
      pair: 'USD/VES',
    });
    await expect(rates.quote({ method: 'ZELLE', currency: 'USD', amount: 7.5 })).resolves.toMatchObject({
      applicable: false,
      vesAmount: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the original amount when the rate service does not answer', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
    const rates = new ExchangeRateService(config as never);
    await expect(rates.quote({ method: 'BINANCE', currency: 'USD', amount: 10 })).resolves.toMatchObject({
      applicable: true,
      vesAmount: null,
      source: null,
    });
  });
});
