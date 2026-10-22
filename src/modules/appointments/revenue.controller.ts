import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RevenueQueryDto } from './dto/revenue-query.dto';
import { RevenueService } from './revenue.service';

@ApiTags('Spa analytics')
@ApiBearerAuth()
@Controller('spa/analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SPA_ADMIN')
export class RevenueController {
  constructor(private readonly revenue: RevenueService) {}
  @Get('revenue') get(
    @CurrentUser() user: AuthUser,
    @Query() query: RevenueQueryDto,
  ) {
    return this.revenue.get(user.spaId!, query);
  }
}
