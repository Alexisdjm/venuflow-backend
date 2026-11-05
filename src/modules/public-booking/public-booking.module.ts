import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { MailModule } from '../mail/mail.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { PublicBookingRequestsController } from './public-booking-requests.controller';
import { PublicBookingRequestsService } from './public-booking-requests.service';
import { PublicBookingController } from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';

@Module({
  imports: [AvailabilityModule, MailModule, SchedulingModule],
  controllers: [PublicBookingController, PublicBookingRequestsController],
  providers: [PublicBookingService, PublicBookingRequestsService],
})
export class PublicBookingModule {}
