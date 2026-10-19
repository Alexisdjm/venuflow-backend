import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
describe('AuthService', () => {
  it('returns a token for valid active credentials', async () => {
    const passwordHash = await argon2.hash('correct-password');
    const prisma = {
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
    const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
    await expect(
      new AuthService(prisma as never, jwt as never).login({
        email: 'a@b.com',
        password: 'correct-password',
      }),
    ).resolves.toMatchObject({ accessToken: 'token' });
  });
  it('uses the same public error for bad credentials', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    await expect(
      new AuthService(prisma as never, { signAsync: jest.fn() } as never).login(
        { email: 'none@b.com', password: 'wrong-password' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
