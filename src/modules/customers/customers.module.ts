import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { PackageInactivityService } from './package-inactivity.service';
import { PackagePlanService } from './package-plan.service';

@Module({
  imports: [SchedulingModule],
  controllers: [CustomersController],
  providers: [CustomersService, PackagePlanService, PackageInactivityService],
  exports: [PackageInactivityService],
})
export class CustomersModule {}
