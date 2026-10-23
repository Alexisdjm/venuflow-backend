import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('records an audit event', async () => {
    const event = { action: 'TEST', entityType: 'Entity' };
    const prisma = {
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const service = new AuditService(prisma as never);

    await expect(service.record(event)).resolves.toEqual({ id: 'audit-1' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: event });
  });

  it.each([
    [undefined, {}],
    ['spa-1', { spaId: 'spa-1' }],
  ])('lists paginated audit records for %s', async (spaId, where) => {
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockReturnValue('find-query'),
        count: jest.fn().mockReturnValue('count-query'),
      },
      $transaction: jest.fn().mockResolvedValue([[{ id: 'audit-1' }], 1]),
    };
    const service = new AuditService(prisma as never);

    const result = await service.list(spaId, { page: 2, limit: 10 });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where,
      skip: 10,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual({
      data: [{ id: 'audit-1' }],
      meta: { page: 2, limit: 10, total: 1 },
    });
  });
});
