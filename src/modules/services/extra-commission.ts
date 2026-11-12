import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

type StoredExtra = {
  extraCommission?: boolean;
  extraCommissionRate?: Prisma.Decimal | string | number | null;
};

export function normalizeExtraCommission(
  enabled: boolean | undefined,
  rate: string | undefined,
  current?: StoredExtra,
) {
  const on = enabled ?? current?.extraCommission ?? false;
  if (!on) {
    return {
      extraCommission: false,
      extraCommissionRate: new Prisma.Decimal(0),
    };
  }
  const raw =
    rate ??
    (current?.extraCommissionRate == null
      ? undefined
      : String(current.extraCommissionRate));
  if (!raw?.trim()) {
    throw new BadRequestException('Indica el porcentaje de comisión extra');
  }
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(raw);
  } catch {
    throw new BadRequestException('La comisión extra no es un porcentaje válido');
  }
  if (amount.decimalPlaces() > 2 || amount.lte(0) || amount.gt(100)) {
    throw new BadRequestException('La comisión extra debe estar entre 0.01 y 100');
  }
  return { extraCommission: true, extraCommissionRate: amount };
}

export function effectiveCommissionRate(
  base: Prisma.Decimal | string | number,
  service?: StoredExtra | null,
) {
  const commission = new Prisma.Decimal(base);
  if (!service?.extraCommission) return commission;
  const total = commission.plus(new Prisma.Decimal(service.extraCommissionRate ?? 0));
  return total.gt(100) ? new Prisma.Decimal(100) : total;
}
