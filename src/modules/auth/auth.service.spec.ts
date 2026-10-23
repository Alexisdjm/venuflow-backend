import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
describe('AuthService', () => {
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  const config = {
    get: jest.fn((_key: string, fallback: unknown) => fallback),
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns a token for valid active credentials', async () => {
    const passwordHash = await argon2.hash('correct-password');
    const prisma = {
      session: { create: jest.fn().mockResolvedValue({}) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u',
          spaId: 's',
          email: 'a@b.com',
          role: 'SPA_ADMIN',
          status: 'ACTIVE',
          spa: { status: 'ACTIVE' },
          passwordHash,
        }),
      },
    };
    await expect(
      new AuthService(prisma as never, jwt as never, config as never).login({
        email: 'a@b.com',
        password: 'correct-password',
      }),
    ).resolves.toMatchObject({ accessToken: 'token' });
  });
  it('uses the same public error for bad credentials', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    await expect(
      new AuthService(
        prisma as never,
        { signAsync: jest.fn() } as never,
        { get: jest.fn() } as never,
      ).login({ email: 'none@b.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects active credentials when the spa is suspended', async () => {
    const passwordHash = await argon2.hash('correct-password');
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u',
          spaId: 's',
          email: 'a@b.com',
          role: 'SPA_ADMIN',
          status: 'ACTIVE',
          spa: { status: 'SUSPENDED' },
          passwordHash,
        }),
      },
    };

    await expect(
      new AuthService(prisma as never, jwt as never, config as never).login({
        email: 'a@b.com',
        password: 'correct-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown refresh token', async () => {
    const prisma = {
      session: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    await expect(
      new AuthService(prisma as never, jwt as never, config as never).refresh(
        'unknown',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes a refresh-token family when reuse is detected', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      session: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-id',
          familyId: 'family-id',
          revokedAt: new Date(),
          user: {},
        }),
        updateMany,
      },
    };
    const service = new AuthService(
      prisma as never,
      jwt as never,
      config as never,
    );

    await expect(service.refresh('reused')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-id', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rotates an active refresh token atomically', async () => {
    const user = {
      id: 'u',
      spaId: 's',
      email: 'a@b.com',
      role: 'SPA_ADMIN',
      status: 'ACTIVE',
      spa: { status: 'ACTIVE' },
    };
    const existing = {
      id: 'session-id',
      userId: 'u',
      familyId: 'family-id',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user,
    };
    const tx = {
      session: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'next-session-id' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      session: { findUnique: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new AuthService(
      prisma as never,
      jwt as never,
      config as never,
    );

    await expect(service.refresh('active')).resolves.toMatchObject({
      accessToken: 'token',
      tokenType: 'Bearer',
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'session-id', revokedAt: null } }),
    );
    expect(tx.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { replacedByTokenId: 'next-session-id' },
      }),
    );
  });

  it('logs out idempotently and revokes the whole token family', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      session: {
        findUnique: jest.fn().mockResolvedValue({ familyId: 'family-id' }),
        updateMany,
      },
    };
    const service = new AuthService(
      prisma as never,
      jwt as never,
      config as never,
    );

    await expect(service.logout('refresh')).resolves.toEqual({ success: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-id', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
