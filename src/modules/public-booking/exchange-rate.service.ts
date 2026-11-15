import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { exchangeKind, readBinanceRate, readOfficialRate, vesFromRate, type ExchangeSource } from './exchange-rate';

const FRESH_MS = { BCV: 6 * 60 * 60_000, BINANCE: 20 * 60_000 };
const STALE_MS = { BCV: 24 * 60 * 60_000, BINANCE: 2 * 60 * 60_000 };

type CachedRate = { rate: string; quotedAt: string; freshUntil: number; staleUntil: number };

@Injectable()
export class ExchangeRateService {
  private readonly cache = new Map<string, CachedRate>();

  constructor(private readonly config: ConfigService) {}

  async quote(input: { method: string; currency: string; amount: number }) {
    const kind = exchangeKind(input.method, input.currency);
    const empty = {
      amount: input.amount,
      currency: input.currency,
      applicable: Boolean(kind),
      vesAmount: null as number | null,
      source: null as ExchangeSource | null,
      pair: null as string | null,
      rate: null as number | null,
      quotedAt: null as string | null,
    };
    const conversion = await this.convert(input);
    if (!conversion) return empty;
    return {
      ...empty,
      vesAmount: Number(conversion.vesAmount.toFixed(2)),
      source: conversion.source,
      pair: conversion.pair,
      rate: Number(conversion.rate.toString()),
      quotedAt: conversion.quotedAt,
    };
  }

  async convert(input: { method: string; currency: string; amount: number | Prisma.Decimal }) {
    const kind = exchangeKind(input.method, input.currency);
    if (!kind) return null;
    try {
      const current = await this.current(kind.source, input.currency);
      return {
        ...kind,
        rate: current.rate,
        quotedAt: current.quotedAt,
        vesAmount: vesFromRate(input.amount, current.rate),
      };
    } catch {
      return null;
    }
  }

  private async current(source: ExchangeSource, currency: string) {
    const key = `${source}:${source === 'BINANCE' ? 'USDT' : currency}`;
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && hit.freshUntil > now) return { rate: new Prisma.Decimal(hit.rate), quotedAt: hit.quotedAt };
    try {
      const fresh = source === 'BINANCE' ? await this.binance() : await this.official(currency);
      this.cache.set(key, {
        rate: fresh.rate.toString(),
        quotedAt: fresh.quotedAt,
        freshUntil: now + FRESH_MS[source],
        staleUntil: now + STALE_MS[source],
      });
      return fresh;
    } catch (error) {
      if (hit && hit.staleUntil > now) return { rate: new Prisma.Decimal(hit.rate), quotedAt: hit.quotedAt };
      throw error;
    }
  }

  private async official(currency: string) {
    const base = (this.config.get<string>('DOLARAPI_BASE_URL') ?? 'https://ve.dolarapi.com').replace(/\/$/, '');
    const path = currency === 'EUR' ? '/v1/euros/oficial' : '/v1/dolares/oficial';
    return readOfficialRate(await this.readJson(`${base}${path}`));
  }

  private async binance() {
    const url = new URL(this.config.get<string>('BINANCE_P2P_QUOTE_URL') ?? 'https://www.binance.com/bapi/c2c/v1/public/c2c/agent/quote-price');
    url.searchParams.set('fiat', 'VES');
    url.searchParams.set('asset', 'USDT');
    url.searchParams.set('tradeType', 'BUY');
    return readBinanceRate(await this.readJson(url.toString()));
  }

  private async readJson(url: string) {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error('La tasa no está disponible');
    return response.json() as Promise<unknown>;
  }
}
