import { Module } from '@nestjs/common';
import {
  MyServicesController,
  ServicesController,
} from './services.controller';
import { ServicesService } from './services.service';
@Module({
  controllers: [ServicesController, MyServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
