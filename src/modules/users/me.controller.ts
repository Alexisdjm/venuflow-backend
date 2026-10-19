import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { ProfessionalsService } from '../professionals/professionals.service';
@ApiTags('Profile')
@ApiBearerAuth()
@Controller('me')
@UseGuards(AuthGuard('jwt'))
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly professionals: ProfessionalsService,
  ) {}
  @Get() async me(@CurrentUser() u: AuthUser) {
    const user = await this.auth.me(u.sub);
    const professional =
      u.role === 'PROFESSIONAL' && u.spaId
        ? await this.professionals.own(u.spaId, u.sub)
        : null;
    return { ...user, professional };
  }
}
