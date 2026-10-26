import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MailModule } from '../mail/mail.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { AppointmentBundlesService } from './appointment-bundles.service';
@Module({
  imports: [AuditModule, MailModule],
  controllers: [AppointmentsController, RevenueController],
  providers: [AppointmentsService, AppointmentBundlesService, RevenueService],
})
export class AppointmentsModule {}
