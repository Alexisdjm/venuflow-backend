import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { SPA_CURRENCIES } from './dto/spa.dto';

export const REMOTE_DEPOSIT_MODES = ['NONE', 'PERCENT', 'FIXED'] as const;
export const REMOTE_PAYMENT_METHODS = [
  'PAGO_MOVIL',
  'ZELLE',
  'BINANCE',
  'PAYPAL',
  'TRANSFER',
] as const;
export const MAX_PAYMENT_METHODS = 8;
export const DEFAULT_HOLD_MINUTES = 240;
export const VENEZUELAN_BANKS = [
  '0102 - Banco de Venezuela',
  '0104 - Venezolano de Crédito',
  '0105 - Mercantil',
  '0108 - BBVA Provincial',
  '0114 - Bancaribe',
  '0115 - Banco Exterior',
  '0128 - Banco Caroní',
  '0134 - Banesco',
  '0137 - Sofitasa',
  '0138 - Banco Plaza',
  '0146 - Bangente',
  '0151 - BFC Banco Fondo Común',
  '0156 - 100% Banco',
  '0157 - DelSur',
  '0163 - Banco del Tesoro',
  '0166 - Banco Agrícola de Venezuela',
  '0168 - Bancrecer',
  '0169 - R4 Banco Microfinanciero',
  '0171 - Banco Activo',
  '0172 - Bancamiga',
  '0174 - Banplus',
  '0175 - Banco Digital de los Trabajadores',
  '0177 - BANFANB',
  '0178 - N58 Banco Digital',
  '0191 - BNC Banco Nacional de Crédito',
] as const;

export type RemoteDepositMode = (typeof REMOTE_DEPOSIT_MODES)[number];
export type RemotePaymentMethod = (typeof REMOTE_PAYMENT_METHODS)[number];

const currencies = new Set<string>(SPA_CURRENCIES);

export function defaultRequiresProof(type: RemotePaymentMethod) {
  return type !== 'PAGO_MOVIL';
}

export function parseDepositPolicy(input: {
  mode: RemoteDepositMode;
  value?: number | null;
  currency?: string | null;
  holdMinutes?: number;
}) {
  const holdMinutes = input.holdMinutes ?? DEFAULT_HOLD_MINUTES;
  if (!Number.isInteger(holdMinutes) || holdMinutes < 60 || holdMinutes > 1440) {
    throw new BadRequestException('El tiempo de revisión debe estar entre 1 y 24 horas');
  }
  if (input.mode === 'NONE') {
    if (input.value != null || input.currency) {
      throw new BadRequestException('Sin adelanto no se indica monto ni moneda');
    }
    return {
      remoteDepositMode: 'NONE' as const,
      remoteDepositValue: null,
      remoteDepositCurrency: null,
      paymentReviewHoldMinutes: holdMinutes,
    };
  }
  if (input.mode === 'PERCENT') {
    assertAmount(input.value, 1, 100, 'El porcentaje');
    if (input.currency) {
      throw new BadRequestException('El porcentaje usa la moneda de cada servicio');
    }
    return {
      remoteDepositMode: 'PERCENT' as const,
      remoteDepositValue: input.value,
      remoteDepositCurrency: null,
      paymentReviewHoldMinutes: holdMinutes,
    };
  }
  assertAmount(input.value, 0.01, 100000, 'El monto fijo');
  if (!input.currency || !currencies.has(input.currency)) {
    throw new BadRequestException('Indica la moneda del monto fijo');
  }
  return {
    remoteDepositMode: 'FIXED' as const,
    remoteDepositValue: input.value,
    remoteDepositCurrency: input.currency,
    paymentReviewHoldMinutes: holdMinutes,
  };
}

export function parsePaymentLabel(value: string) {
  const label = value.trim().replace(/\s+/g, ' ');
  if (label.length < 2 || label.length > 80) {
    throw new BadRequestException('El nombre del método debe tener entre 2 y 80 caracteres');
  }
  return label;
}

export function parsePaymentDetails(type: RemotePaymentMethod, input: unknown) {
  const source = asRecord(input);
  if (type === 'PAGO_MOVIL') {
    return {
      phone: digits(source.phone, 10, 15, 'El teléfono'),
      nationalId: digits(source.nationalId, 5, 12, 'La cédula'),
      bank: venezuelanBank(source.bank),
    };
  }
  if (type === 'ZELLE') {
    const email = optionalEmail(source.email);
    const phone = source.phone == null || source.phone === '' ? undefined : digits(source.phone, 10, 15, 'El teléfono');
    if (!email && !phone) {
      throw new BadRequestException('Zelle necesita un correo o un teléfono');
    }
    return {
      holder: text(source.holder, 2, 80, 'El titular'),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
    };
  }
  if (type === 'BINANCE') {
    return {
      payId: text(source.payId, 2, 80, 'El identificador de Binance'),
      ...(blank(source.note) ? {} : { note: text(source.note, 1, 120, 'La nota') }),
    };
  }
  if (type === 'PAYPAL') {
    const email = optionalEmail(source.email);
    const link = source.link == null || source.link === '' ? undefined : url(source.link);
    if (!email && !link) {
      throw new BadRequestException('PayPal necesita un correo o un enlace');
    }
    return {
      ...(email ? { email } : {}),
      ...(link ? { link } : {}),
    };
  }
  return {
    bank: text(source.bank, 2, 40, 'El banco'),
    accountNumber: text(source.accountNumber, 4, 34, 'El número de cuenta'),
    holder: text(source.holder, 2, 80, 'El titular'),
    ...(blank(source.nationalId) ? {} : { nationalId: digits(source.nationalId, 5, 12, 'La cédula') }),
  };
}

export function depositQuote(input: {
  mode: 'PERCENT' | 'FIXED';
  percent: number | null;
  fixedAmount: number | null;
  fixedCurrency: string | null;
  serviceTotal: Prisma.Decimal;
  serviceCurrency: string;
}) {
  if (input.mode === 'FIXED') {
    if (input.fixedAmount == null || !input.fixedCurrency) {
      throw new BadRequestException('El adelanto fijo no está configurado');
    }
    return {
      amount: new Prisma.Decimal(input.fixedAmount).toDecimalPlaces(2),
      currency: input.fixedCurrency,
    };
  }
  if (input.percent == null) {
    throw new BadRequestException('El porcentaje de adelanto no está configurado');
  }
  return {
    amount: input.serviceTotal.mul(input.percent).div(100).toDecimalPlaces(2),
    currency: input.serviceCurrency,
  };
}

export function parsePaymentReference(value: unknown) {
  if (typeof value !== 'string') {
    throw new BadRequestException('Indica la referencia del pago');
  }
  const reference = value.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 -]{4,40}$/.test(reference)) {
    throw new BadRequestException('La referencia debe tener entre 4 y 40 caracteres');
  }
  return reference;
}

export function parsePagoMovilSender(input: unknown) {
  const source = asRecord(input);
  return {
    nationalId: digits(source.nationalId, 5, 12, 'La cédula'),
    phone: digits(source.phone, 10, 15, 'El teléfono'),
    bank: venezuelanBank(source.bank),
  };
}

export function toPublicBookingPolicy(
  policy: {
    remoteDepositMode: RemoteDepositMode;
    remoteDepositValue: number | null;
    remoteDepositCurrency: string | null;
    paymentReviewHoldMinutes: number;
  },
  methods: Array<{
    id: string;
    type: RemotePaymentMethod;
    label: string;
    requiresProof: boolean;
    details: unknown;
    isActive: boolean;
    sortOrder: number;
  }>,
) {
  const active = methods
    .filter((method) => method.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label));
  return {
    deposit:
      policy.remoteDepositMode === 'PERCENT'
        ? { mode: 'PERCENT' as const, percent: policy.remoteDepositValue }
        : policy.remoteDepositMode === 'FIXED'
          ? {
              mode: 'FIXED' as const,
              amount: policy.remoteDepositValue,
              currency: policy.remoteDepositCurrency,
            }
          : { mode: 'NONE' as const },
    holdMinutes: policy.paymentReviewHoldMinutes,
    methods: active.map((method) => ({
      id: method.id,
      type: method.type,
      label: method.label,
      requiresProof: method.requiresProof,
      details: method.details,
    })),
  };
}

function assertAmount(
  value: number | null | undefined,
  min: number,
  max: number,
  label: string,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new BadRequestException(`${label} no es válido`);
  }
  if (Math.round(value * 100) !== value * 100) {
    throw new BadRequestException(`${label} admite hasta dos decimales`);
  }
}

function asRecord(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Indica los datos del método de pago');
  }
  return input as Record<string, unknown>;
}

function blank(value: unknown) {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function venezuelanBank(value: unknown) {
  const bank = text(value, 7, 80, 'El banco');
  if (!VENEZUELAN_BANKS.includes(bank as (typeof VENEZUELAN_BANKS)[number])) {
    throw new BadRequestException('Elige un banco de la lista');
  }
  return bank;
}

function text(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'string') throw new BadRequestException(`${label} es obligatorio`);
  const clean = value.trim().replace(/\s+/g, ' ');
  if (clean.length < min || clean.length > max) {
    throw new BadRequestException(`${label} no es válido`);
  }
  return clean;
}

function digits(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'string') throw new BadRequestException(`${label} es obligatorio`);
  const clean = value.replace(/[^\d]/g, '');
  if (clean.length < min || clean.length > max) {
    throw new BadRequestException(`${label} no es válido`);
  }
  return clean;
}

function optionalEmail(value: unknown) {
  if (blank(value)) return undefined;
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || value.trim().length > 120) {
    throw new BadRequestException('El correo no es válido');
  }
  return value.trim().toLowerCase();
}

function url(value: unknown) {
  if (typeof value !== 'string') throw new BadRequestException('El enlace no es válido');
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new BadRequestException('El enlace no es válido');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new BadRequestException('El enlace debe usar https');
  }
  return parsed.toString();
}
