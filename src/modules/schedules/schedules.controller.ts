import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dto';
import { SchedulesService } from './schedules.service';
@ApiTags('Professional schedules')
@ApiBearerAuth()
@Controller('spa/professionals/:professionalId/schedules')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SPA_ADMIN')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}
  @Get() list(
    @CurrentUser() u: AuthUser,
    @Param('professionalId', ParseUUIDPipe) p: string,
  ) {
    return this.schedules.list(u.spaId!, p);
  }
  @Post() create(
    @CurrentUser() u: AuthUser,
    @Param('professionalId', ParseUUIDPipe) p: string,
    @Body() d: CreateScheduleDto,
  ) {
    return this.schedules.create(u.spaId!, u.sub, p, d);
  }
  @Patch(':id') update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: UpdateScheduleDto,
  ) {
    return this.schedules.update(u.spaId!, u.sub, id, d);
  }
  @Delete(':id') remove(
    @CurrentUser() u: AuthUser,
    @Param('professionalId', ParseUUIDPipe) professionalId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.schedules.remove(u.spaId!, u.sub, professionalId, id);
  }
}
@ApiTags('Professional profile')
@ApiBearerAuth()
@Controller('me/schedules')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('PROFESSIONAL')
export class MySchedulesController {
  constructor(private readonly schedules: SchedulesService) {}
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.schedules.listOwn(u.spaId!, u.sub);
  }
}
