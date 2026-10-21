import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateServiceDto, UpdateServiceDto } from './dto/service.dto';
import { ServicesService } from './services.service';

@ApiTags('Spa services')
@ApiBearerAuth()
@Controller('spa/services')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SPA_ADMIN')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: PaginationDto) {
    return this.services.list(u.spaId!, q);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() d: CreateServiceDto) {
    return this.services.create(u.spaId!, u.sub, d);
  }
  @Get(':id') get(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.services.get(u.spaId!, id);
  }
  @Patch(':id') update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: UpdateServiceDto,
  ) {
    return this.services.update(u.spaId!, u.sub, id, d);
  }
  @Put(':serviceId/professionals/:professionalId') assign(
    @CurrentUser() u: AuthUser,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Param('professionalId', ParseUUIDPipe) professionalId: string,
  ) {
    return this.services.assign(u.spaId!, u.sub, professionalId, serviceId);
  }
  @Delete(':serviceId/professionals/:professionalId') unassign(
    @CurrentUser() u: AuthUser,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Param('professionalId', ParseUUIDPipe) professionalId: string,
  ) {
    return this.services.unassign(u.spaId!, u.sub, professionalId, serviceId);
  }
}

@ApiTags('Professional profile')
@ApiBearerAuth()
@Controller('me/services')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('PROFESSIONAL')
export class MyServicesController {
  constructor(private readonly services: ServicesService) {}
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.services.listOwn(u.spaId!, u.sub);
  }
}
