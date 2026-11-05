import { databaseConflict } from './database-conflict';
import { Prisma } from '../generated/prisma/client';

describe('Expected database conflicts', () => {
  it.each(['P2002', 'P2003', 'P2004', 'P2025', 'P2028', 'P2034'])(
    'maps Prisma %s without private details',
    (code) => {
      const error = new Prisma.PrismaClientKnownRequestError(
        'PRIVATE SQL AND PII',
        { code, clientVersion: 'test' },
      );
      const mapped = databaseConflict(error);
      expect(mapped?.getStatus()).toBe(409);
      expect(mapped?.message).not.toContain('PRIVATE');
    },
  );
  it.each(['23505', '23503', '23514', '23P01', '40001', '40P01', '55P03'])(
    'maps PostgreSQL/adapter %s',
    (code) => {
      expect(
        databaseConflict({
          meta: { driverAdapterError: { cause: { originalCode: code } } },
        })?.getStatus(),
      ).toBe(409);
      expect(
        databaseConflict({ code: 'P2010', meta: { code } })?.getStatus(),
      ).toBe(409);
    },
  );
  it('does not hide unrelated programming or connectivity errors as business conflicts', () => {
    expect(databaseConflict(new Error('programming failure'))).toBeUndefined();
    expect(databaseConflict({ code: 'P1001' })).toBeUndefined();
    const circular: { cause?: unknown } = {};
    circular.cause = circular;
    expect(databaseConflict(circular)).toBeUndefined();
  });
});
