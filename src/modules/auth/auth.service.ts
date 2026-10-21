import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UserRole } from '../../generated/prisma/enums';
import { LoginDto } from './dto/login.dto';

type SessionUser = {
  id: string;
  spaId: string | null;
  role: UserRole;
  email: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async accessToken(user: SessionUser) {
    return this.jwt.signAsync({
      sub: user.id,
      spaId: user.spaId,
      role: user.role,
      email: user.email,
    });
  }

  private refreshExpiry() {
    return new Date(
      Date.now() +
        this.config.get<number>('REFRESH_TOKEN_EXPIRES_DAYS', 30) * 86_400_000,
    );
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      include: { spa: true },
    });
    const valid = user
      ? await argon2.verify(user.passwordHash, dto.password).catch(() => false)
      : await argon2.hash(dto.password).then(() => false);
    if (
      !user ||
      !valid ||
      user.status !== 'ACTIVE' ||
      (user.spa && user.spa.status !== 'ACTIVE')
    )
      throw new UnauthorizedException('Invalid email or password');

    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = this.refreshExpiry();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: this.tokenHash(refreshToken),
        expiresAt,
      },
    });
    return {
      accessToken: await this.accessToken(user),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '15m'),
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  async refresh(refreshToken: string) {
    const existing = await this.prisma.session.findUnique({
      where: { tokenHash: this.tokenHash(refreshToken) },
      include: { user: { include: { spa: true } } },
    });
    if (!existing) throw new UnauthorizedException('Invalid refresh token');
    if (existing.revokedAt) {
      await this.prisma.session.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (
      existing.expiresAt <= new Date() ||
      existing.user.status !== 'ACTIVE' ||
      (existing.user.spa && existing.user.spa.status !== 'ACTIVE')
    )
      throw new UnauthorizedException('Session is not active');

    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.session.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new UnauthorizedException('Refresh token reuse detected');
      const nextToken = randomBytes(48).toString('base64url');
      const expiresAt = this.refreshExpiry();
      const next = await tx.session.create({
        data: {
          userId: existing.userId,
          familyId: existing.familyId,
          tokenHash: this.tokenHash(nextToken),
          expiresAt,
        },
      });
      await tx.session.update({
        where: { id: existing.id },
        data: { replacedByTokenId: next.id },
      });
      return {
        accessToken: await this.accessToken(existing.user),
        refreshToken: nextToken,
        tokenType: 'Bearer',
        expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '15m'),
        refreshTokenExpiresAt: expiresAt.toISOString(),
      };
    });
  }

  async logout(refreshToken: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.tokenHash(refreshToken) },
    });
    if (session)
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    return { success: true };
  }

  async me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        spaId: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
