import { UsersService } from './users.service';

describe('UsersService', () => {
  it('lists only users from the requested spa without password hashes', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockReturnValue('find-query'),
        count: jest.fn().mockReturnValue('count-query'),
      },
      $transaction: jest.fn().mockResolvedValue([[{ id: 'user-1' }], 12]),
    };
    const service = new UsersService(prisma as never);

    const result = await service.list('spa-1', { page: 2, limit: 5 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaId: 'spa-1' },
        skip: 5,
        take: 5,
        select: expect.objectContaining({ email: true, role: true }),
      }),
    );
    expect(prisma.user.findMany.mock.calls[0][0].select).not.toHaveProperty(
      'passwordHash',
    );
    expect(result.meta).toEqual({ page: 2, limit: 5, total: 12 });
  });
});
