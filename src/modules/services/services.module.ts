import { Module } from '@nestjs/common';
import {
  MyServicesController,
  ServiceCategoriesController,
  ServicesController,
} from './services.controller';
import { ServicesService } from './services.service';
@Module({
  controllers: [
    ServiceCategoriesController,
    ServicesController,
    MyServicesController,
  ],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
