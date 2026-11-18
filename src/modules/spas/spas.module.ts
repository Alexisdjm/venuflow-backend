import { Module } from '@nestjs/common';
import { PlatformSpasController } from './platform-spas.controller';
import { SpaAdminController } from './spa-admin.controller';
import { BookingPaymentsService } from './booking-payments.service';
import { SpaNotificationsController } from './spa-notifications.controller';
import { SpaNotificationsService } from './spa-notifications.service';
import { SpaSetupService } from './spa-setup.service';
import { SpasService } from './spas.service';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { UsersModule } from '../users/users.module';
import { ProfessionalsModule } from '../professionals/professionals.module';
import { ServicesModule } from '../services/services.module';
@Module({
  imports: [UsersModule, ProfessionalsModule, ServicesModule, SchedulingModule],
  controllers: [PlatformSpasController, SpaAdminController, SpaNotificationsController],
  providers: [SpasService, BookingPaymentsService, SpaNotificationsService, SpaSetupService],
  exports: [BookingPaymentsService],
})
export class SpasModule {}
