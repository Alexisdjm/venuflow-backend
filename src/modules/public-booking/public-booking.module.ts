import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { MailModule } from '../mail/mail.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { VisitBundleModule } from '../../verticals/spa/visit-bundle/visit-bundle.module';
import { SpasModule } from '../spas/spas.module';
import { BookingReviewsController } from './booking-reviews.controller';
import { PublicBookingRequestsController } from './public-booking-requests.controller';
import { PublicBookingRequestsService } from './public-booking-requests.service';
import { PublicBookingController } from './public-booking.controller';
import { ExchangeRateService } from './exchange-rate.service';
import { PaymentProofStore } from './payment-proof.store';
import { PublicBookingService } from './public-booking.service';

@Module({
  imports: [AvailabilityModule, MailModule, SchedulingModule, SpasModule, VisitBundleModule],
  controllers: [PublicBookingController, PublicBookingRequestsController, BookingReviewsController],
  providers: [PublicBookingService, PublicBookingRequestsService, PaymentProofStore, ExchangeRateService],
})
export class PublicBookingModule {}
