import { Prisma } from '../../generated/prisma/client';
import type { RemotePaymentMethod } from '../spas/booking-payments';

export const EXCHANGE_SOURCES = ['BCV', 'BINANCE'] as const;
export type ExchangeSource = (typeof EXCHANGE_SOURCES)[number];

const bolivarMethods = new Set<RemotePaymentMethod>(['PAGO_MOVIL', 'TRANSFER', 'BINANCE']);

export function exchangeKind(method: string, currency: string) {
  if (!bolivarMethods.has(method as RemotePaymentMethod) || currency === 'VES') return null;
  if (method === 'BINANCE' || currency === 'USDT') return { source: 'BINANCE' as const, pair: 'USDT/VES' };
  if (currency === 'EUR') return { source: 'BCV' as const, pair: 'EUR/VES' };
  if (currency === 'USD') return { source: 'BCV' as const, pair: 'USD/VES' };
  return null;
}

export function vesFromRate(amount: Prisma.Decimal | number | string, rate: Prisma.Decimal | number | string) {
  return new Prisma.Decimal(amount).mul(rate).toDecimalPlaces(2);
}

export function readOfficialRate(payload: unknown) {
  if (!payload || typeof payload !== 'object') throw new Error('La tasa oficial no está disponible');
  const row = payload as { promedio?: unknown; fechaActualizacion?: unknown };
  const rate = decimalRate(row.promedio);
  const quotedAt = typeof row.fechaActualizacion === 'string' && row.fechaActualizacion
    ? row.fechaActualizacion
    : new Date().toISOString();
  return { rate, quotedAt };
}

export function readBinanceRate(payload: unknown, now = new Date()) {
  if (!payload || typeof payload !== 'object') throw new Error('La tasa de Binance no está disponible');
  const row = payload as { success?: unknown; data?: { price?: unknown } };
  if (row.success !== true) throw new Error('La tasa de Binance no está disponible');
  return { rate: decimalRate(row.data?.price), quotedAt: now.toISOString() };
}

function decimalRate(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error('La tasa no es válida');
  }
  const rate = new Prisma.Decimal(value);
  if (rate.isNaN() || rate.lte(0)) throw new Error('La tasa no es válida');
  return rate;
}
