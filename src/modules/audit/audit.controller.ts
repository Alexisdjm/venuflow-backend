import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from './audit.service';

@ApiTags('Platform audit')
@ApiBearerAuth()
@Controller('platform/audit-logs')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('PLATFORM_ADMIN')
export class PlatformAuditController {
  constructor(private readonly audit: AuditService) {}
  @Get() list(@Query() query: PaginationDto) {
    return this.audit.list(undefined, query);
  }
}

@ApiTags('Spa audit')
@ApiBearerAuth()
@Controller('spa/audit-logs')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SPA_ADMIN')
export class SpaAuditController {
  constructor(private readonly audit: AuditService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) {
    return this.audit.list(user.spaId!, query);
  }
}
