import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../../database/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}
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
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      spaId: user.spaId,
      role: user.role,
      email: user.email,
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    };
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
