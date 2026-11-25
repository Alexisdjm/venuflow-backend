import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PackagePlanDto } from './dto/customer-package.dto';
import { PackagePlanService } from './package-plan.service';

@ApiTags('Package plans')
@ApiBearerAuth()
@Controller('spa/package-plans')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SPA_ADMIN')
export class PackagePlansController {
  constructor(private readonly plans: PackagePlanService) {}

  @Post('preview')
  preview(@CurrentUser() user: AuthUser, @Body() dto: PackagePlanDto) {
    return this.plans.preview(user.spaId!, undefined, dto);
  }

  @Post()
  confirm(@CurrentUser() user: AuthUser, @Body() dto: PackagePlanDto) {
    return this.plans.confirm(user.spaId!, user.sub, undefined, dto);
  }
}
