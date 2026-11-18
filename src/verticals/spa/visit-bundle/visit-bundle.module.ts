import { Module } from '@nestjs/common';
import { SchedulingModule } from '../../../modules/scheduling/scheduling.module';
import { AppointmentBundlesService } from './appointment-bundles.service';
import { PublicVisitSequenceService } from './public-visit-sequence.service';

@Module({
  imports: [SchedulingModule],
  providers: [AppointmentBundlesService, PublicVisitSequenceService],
  exports: [AppointmentBundlesService, PublicVisitSequenceService],
})
export class VisitBundleModule {}
