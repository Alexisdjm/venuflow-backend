import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ProfessionalsService } from '../professionals/professionals.service';
import { ServicesService } from '../services/services.service';
import { SpasService } from './spas.service';
import { UpdateOperatingHoursDto } from './dto/operating-hours.dto';
import {
  CreateProfessionalDto,
  CreateOwnProfessionalDto,
  UpdateProfessionalDto,
} from '../professionals/dto/professional.dto';
@ApiTags('Spa administration')
@ApiBearerAuth()
@Controller('spa')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SPA_ADMIN')
export class SpaAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly professionals: ProfessionalsService,
    private readonly services: ServicesService,
    private readonly spas: SpasService,
  ) {}
  private tenant(u: AuthUser) {
    if (!u.spaId) throw new Error('Missing tenant');
    return u.spaId;
  }
  @Get()
  @Roles('SPA_ADMIN', 'PROFESSIONAL')
  getSpa(@CurrentUser() u: AuthUser) {
    return this.prisma.spa.findUniqueOrThrow({ where: { id: this.tenant(u) } });
  }
  @Patch('settings/operating-hours') updateOperatingHours(
    @CurrentUser() u: AuthUser,
    @Body() d: UpdateOperatingHoursDto,
  ) {
    return this.spas.updateOperatingHours(
      u.sub,
      this.tenant(u),
      d.openingMinute,
      d.closingMinute,
    );
  }
  @Get('users') listUsers(
    @CurrentUser() u: AuthUser,
    @Query() q: PaginationDto,
  ) {
    return this.users.list(this.tenant(u), q);
  }
  @Get('professionals') list(
    @CurrentUser() u: AuthUser,
    @Query() q: PaginationDto,
  ) {
    return this.professionals.list(this.tenant(u), q);
  }
  @Post('professionals') create(
    @CurrentUser() u: AuthUser,
    @Body() d: CreateProfessionalDto,
  ) {
    return this.professionals.create(this.tenant(u), u.sub, d);
  }
  @Post('professionals/me') createOwnProfessionalProfile(
    @CurrentUser() u: AuthUser,
    @Body() d: CreateOwnProfessionalDto,
  ) {
    return this.professionals.createForAdmin(this.tenant(u), u.sub, d);
  }
  @Get('professionals/:id') get(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.professionals.get(this.tenant(u), id);
  }
  @Patch('professionals/:id') update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: UpdateProfessionalDto,
  ) {
    return this.professionals.update(this.tenant(u), u.sub, id, d);
  }
  @Get('professionals/:id/services') servicesForProfessional(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.services.listForProfessional(this.tenant(u), id);
  }
}
