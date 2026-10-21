import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto/appointment.dto';
@ApiTags('Appointments') @ApiBearerAuth() @Controller('spa/appointments')
@UseGuards(AuthGuard('jwt'), RolesGuard) @Roles('SPA_ADMIN','PROFESSIONAL')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}
  @Get() list(@CurrentUser() u:AuthUser,@Query('date') date?:string){return this.appointments.list(u,date);}
  @Post() create(@CurrentUser() u:AuthUser,@Body() d:CreateAppointmentDto){return this.appointments.create(u,d);}
  @Patch(':id') update(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string,@Body() d:UpdateAppointmentDto){return this.appointments.update(u,id,d);}
}
