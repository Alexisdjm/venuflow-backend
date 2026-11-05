import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
@Module({
  imports: [SchedulingModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
