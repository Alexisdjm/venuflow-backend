import { Module } from '@nestjs/common';
import {
  MySchedulesController,
  SchedulesController,
} from './schedules.controller';
import { SchedulesService } from './schedules.service';
@Module({
  controllers: [SchedulesController, MySchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
