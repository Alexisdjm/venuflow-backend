import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CustomersService } from './customers.service';
import { CustomerQueryDto } from './dto/customer-query.dto';
import {
  AssignPackageDto,
  PackagePaymentDto,
  PackagePlanDto,
} from './dto/customer-package.dto';
import { PackagePlanService } from './package-plan.service';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('spa/customers')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SPA_ADMIN')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly plans: PackagePlanService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: CustomerQueryDto) {
    return this.customers.list(user.spaId!, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(user.spaId!, id);
  }

  @Post(':id/packages/preview')
  previewPackage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PackagePlanDto,
  ) {
    return this.plans.preview(user.spaId!, id, dto);
  }

  @Post(':id/packages/plan')
  confirmPackage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PackagePlanDto,
  ) {
    return this.plans.confirm(user.spaId!, user.sub, id, dto);
  }

  @Post(':id/packages')
  assignPackage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPackageDto,
  ) {
    return this.customers.assignPackage(user.spaId!, user.sub, id, dto);
  }

  @Post(':id/packages/:packageId/payments')
  payPackage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('packageId', ParseUUIDPipe) packageId: string,
    @Body() dto: PackagePaymentDto,
  ) {
    return this.customers.payPackage(
      user.spaId!,
      user.sub,
      id,
      packageId,
      dto,
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(user.spaId!, user.sub, id, dto);
  }

  @Delete(':id')
  @Roles('SPA_ADMIN')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.remove(user.spaId!, user.sub, id);
  }
}
