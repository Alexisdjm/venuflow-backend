import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuthUser } from '../../common/auth.types';
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow('JWT_ACCESS_SECRET'),
    });
  }
  async validate(payload: AuthUser): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { spa: true },
    });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      (user.spa && user.spa.status !== 'ACTIVE')
    )
      throw new UnauthorizedException('Session is not active');
    if ((user.role === 'PLATFORM_ADMIN') !== (user.spaId === null))
      throw new UnauthorizedException('Invalid account');
    return {
      sub: user.id,
      spaId: user.spaId,
      role: user.role,
      email: user.email,
    };
  }
}
