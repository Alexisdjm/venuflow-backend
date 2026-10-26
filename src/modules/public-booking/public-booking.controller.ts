import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicAvailabilityQueryDto } from './dto/public-availability.dto';
import { PublicBookingService } from './public-booking.service';

@ApiTags('Public booking')
@Controller('public/spas')
export class PublicBookingController {
  constructor(private readonly catalog: PublicBookingService) {}

  @Get(':slug/services')
  services(@Param('slug') slug: string) {
    return this.catalog.services(slug);
  }

  @Get(':slug/professionals')
  professionals(@Param('slug') slug: string, @Query('serviceIds') serviceIds = '') {
    return this.catalog.professionals(slug, serviceIds);
  }

  @Get(':slug/availability')
  availability(@Param('slug') slug: string, @Query() query: PublicAvailabilityQueryDto) {
    return this.catalog.availability(slug, query);
  }

  @Get(':slug')
  spa(@Param('slug') slug: string) {
    return this.catalog.spa(slug);
  }
}
