import { Body, Controller, ForbiddenException, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpdatePayoutCadenceDto } from './dto/spa-notifications.dto';
import { SpaNotificationsService } from './spa-notifications.service';

@ApiTags('Spa notifications')
@ApiBearerAuth()
@Controller('spa/notifications')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SPA_ADMIN')
export class SpaNotificationsController {
  constructor(private readonly notifications: SpaNotificationsService) {}

  @Get()
  feed(@CurrentUser() user: AuthUser) {
    return this.notifications.feed(this.tenant(user));
  }

  @Patch('payout')
  updatePayout(@CurrentUser() user: AuthUser, @Body() dto: UpdatePayoutCadenceDto) {
    return this.notifications.updateCadence(this.tenant(user), dto.cadence);
  }

  private tenant(user: AuthUser) {
    if (!user.spaId) throw new ForbiddenException();
    return user.spaId;
  }
}
