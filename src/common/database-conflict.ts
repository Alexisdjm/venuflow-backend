import { ConflictException } from '@nestjs/common';

/** Whitelist expected database conflicts; never return driver messages to HTTP. */
export function databaseConflict(
  error: unknown,
): ConflictException | undefined {
  const seen = new Set<unknown>();
  const codes = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 7)
      return;
    seen.add(value);
    const row = value as Record<string, unknown>;
    for (const key of ['code', 'originalCode', 'sqlState']) {
      if (typeof row[key] === 'string') codes.add(row[key] as string);
    }
    for (const key of ['meta', 'cause', 'driverAdapterError', 'error'])
      visit(row[key], depth + 1);
  };
  visit(error, 0);
  if (
    [
      'P2002',
      'P2003',
      'P2004',
      'P2025',
      'P2028',
      'P2034',
      '23505',
      '23503',
      '23514',
      '23P01',
      '40001',
      '40P01',
      '55P03',
    ].some((code) => codes.has(code))
  ) {
    return new ConflictException(
      'La operación entra en conflicto con los datos actuales. Revisa la reserva e inténtalo nuevamente.',
    );
  }
  return undefined;
}
