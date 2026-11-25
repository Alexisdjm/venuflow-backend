import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MailModule } from '../mail/mail.module';
import { CustomersModule } from '../customers/customers.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { VisitBundleModule } from '../../verticals/spa/visit-bundle/visit-bundle.module';

@Module({
  imports: [AuditModule, MailModule, SchedulingModule, VisitBundleModule, CustomersModule],
  controllers: [AppointmentsController, RevenueController],
  providers: [AppointmentsService, RevenueService],
})
export class AppointmentsModule {}
