import { SpaSetupService } from './spa-setup.service';

describe('SpaSetupService', () => {
  const spaId = 'spa-1';

  function service(prisma: Record<string, unknown>) {
    return new SpaSetupService(prisma as never);
  }

  it('stays hidden outside the demo plan', async () => {
    const prisma = {
      spa: { findUnique: jest.fn().mockResolvedValue({ plan: 'PLUS', remoteDepositMode: 'NONE' }) },
    };
    await expect(service(prisma).get(spaId)).resolves.toEqual({
      visible: false,
      payments: false,
      deposit: false,
      schedules: false,
      assignments: false,
      teamAccess: null,
    });
  });

  it('keeps payment, deposit and team access open when the trial only has its defaults', async () => {
    const prisma = {
      spa: { findUnique: jest.fn().mockResolvedValue({ plan: 'DEMO', remoteDepositMode: 'NONE' }) },
      spaPaymentMethod: { count: jest.fn().mockResolvedValue(0) },
      professional: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'owner',
            user: { role: 'SPA_ADMIN' },
            schedules: [{ id: 'shift' }],
            services: [{ serviceId: 'nails' }],
          },
          {
            userId: 'extra',
            user: { role: 'PROFESSIONAL' },
            schedules: [{ id: 'shift-2' }],
            services: [{ serviceId: 'nails' }],
          },
        ]),
      },
      spaService: { count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    await expect(service(prisma).get(spaId)).resolves.toEqual({
      visible: true,
      payments: false,
      deposit: false,
      schedules: true,
      assignments: true,
      teamAccess: false,
    });
  });

  it('marks the deposit and team access once they are saved', async () => {
    const prisma = {
      spa: { findUnique: jest.fn().mockResolvedValue({ plan: 'DEMO', remoteDepositMode: 'NONE' }) },
      spaPaymentMethod: { count: jest.fn().mockResolvedValue(1) },
      professional: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'extra',
            user: { role: 'PROFESSIONAL' },
            schedules: [{ id: 'shift' }],
            services: [{ serviceId: 'nails' }],
          },
        ]),
      },
      spaService: { count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue({ id: 'decision' }),
        findMany: jest.fn().mockResolvedValue([{ entityId: 'extra' }]),
      },
    };

    const status = await service(prisma).get(spaId);
    expect(status.payments).toBe(true);
    expect(status.deposit).toBe(true);
    expect(status.teamAccess).toBe(true);
  });
});
