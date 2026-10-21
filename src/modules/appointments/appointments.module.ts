import { Module } from '@nestjs/common';import { AuditModule } from '../audit/audit.module';import { AppointmentsController } from './appointments.controller';import { AppointmentsService } from './appointments.service';
@Module({imports:[AuditModule],controllers:[AppointmentsController],providers:[AppointmentsService]}) export class AppointmentsModule {}
