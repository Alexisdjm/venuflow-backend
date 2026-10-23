import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  const customer = {
    id: 'customer-id',
    name: 'Cliente de prueba',
    nationalId: '12345678',
  };

  it('deletes only non-completed appointments before deleting a customer', async () => {
    const tx = {
      appointment: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      customer: { delete: jest.fn().mockResolvedValue(customer) },
    };
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue(customer) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new CustomersService(prisma as never, audit as never);

    await expect(
      service.remove('spa-id', 'actor-id', customer.id),
    ).resolves.toEqual({ success: true });
    expect(tx.appointment.deleteMany).toHaveBeenCalledWith({
      where: {
        customerId: customer.id,
        spaId: 'spa-id',
        status: { not: 'COMPLETED' },
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOMER_DELETED' }),
    );
  });

  it('protects customers that retain completed appointments', async () => {
    const foreignKeyError = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed',
      { code: 'P2003', clientVersion: 'test' },
    );
    const tx = {
      appointment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      customer: { delete: jest.fn().mockRejectedValue(foreignKeyError) },
    };
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue(customer) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const audit = { record: jest.fn() };
    const service = new CustomersService(prisma as never, audit as never);

    await expect(
      service.remove('spa-id', 'actor-id', customer.id),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('returns tenant-scoped customer details with appointment history', async () => {
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue(customer) },
    };
    const service = new CustomersService(prisma as never, {} as never);

    await expect(service.get('spa-id', customer.id)).resolves.toBe(customer);
    expect(prisma.customer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_spaId: { id: customer.id, spaId: 'spa-id' } },
      }),
    );
  });

  it('does not expose a missing or cross-tenant customer', async () => {
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new CustomersService(prisma as never, {} as never);

    await expect(service.get('spa-id', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps duplicate national IDs to a conflict during updates', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('Duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(customer),
        update: jest.fn().mockRejectedValue(duplicate),
      },
    };
    const audit = { record: jest.fn() };
    const service = new CustomersService(prisma as never, audit as never);

    await expect(
      service.update('spa-id', 'actor-id', customer.id, {
        nationalId: '87654321',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('applies the configured period and search filters when listing', async () => {
    const findMany = jest.fn().mockResolvedValue([customer]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      spa: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Caracas' }),
      },
      customer: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[customer], 1]),
    };
    const service = new CustomersService(prisma as never, {} as never);

    await expect(
      service.list('spa-id', {
        page: 1,
        limit: 20,
        period: 'week',
        search: 'Ana',
      }),
    ).resolves.toEqual({
      data: [customer],
      meta: { page: 1, limit: 20, total: 1 },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          spaId: 'spa-id',
          OR: expect.any(Array),
        }),
      }),
    );
  });
});
