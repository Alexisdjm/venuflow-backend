import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { PaymentProofStore } from '../public-booking/payment-proof.store';
import { BookingPaymentMaintenance } from './booking-payment-maintenance';
import { SchedulingService } from './scheduling.service';

@Module({
  imports: [MailModule],
  providers: [SchedulingService, BookingPaymentMaintenance, PaymentProofStore],
  exports: [SchedulingService, BookingPaymentMaintenance],
})
export class SchedulingModule {}
