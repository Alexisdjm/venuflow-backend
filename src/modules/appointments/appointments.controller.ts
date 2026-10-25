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
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AppointmentsService } from './appointments.service';
import { AppointmentBundlesService } from './appointment-bundles.service';
import {
  BundleAvailabilityDto,
  CreateAppointmentBundleDto,
} from './dto/appointment-bundle.dto';
import {
  CreateAppointmentDto,
  ListAppointmentsDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';
@ApiTags('Appointments')
@ApiBearerAuth()
@Controller('spa/appointments')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SPA_ADMIN', 'PROFESSIONAL')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly bundles: AppointmentBundlesService,
  ) {}
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: ListAppointmentsDto) {
    return this.appointments.list(u, q.date, q.status);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() d: CreateAppointmentDto) {
    return this.appointments.create(u, d);
  }
  @Post('bundle/availability')
  bundleAvailability(
    @CurrentUser() u: AuthUser,
    @Body() d: BundleAvailabilityDto,
  ) {
    return this.bundles.availability(u, d);
  }
  @Post('bundle')
  createBundle(
    @CurrentUser() u: AuthUser,
    @Body() d: CreateAppointmentBundleDto,
  ) {
    return this.bundles.create(u, d);
  }
  @Patch(':id') update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: UpdateAppointmentDto,
  ) {
    return this.appointments.update(u, id, d);
  }
}
