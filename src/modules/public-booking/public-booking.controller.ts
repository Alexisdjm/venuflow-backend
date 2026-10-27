import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicAvailabilityQueryDto } from './dto/public-availability.dto';
import { PublicSequenceAvailabilityDto } from './dto/public-sequence.dto';
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

  @Post(':slug/sequence-availability')
  async sequence(@Param('slug') slug: string, @Body() dto: PublicSequenceAvailabilityDto) {
    const plans = await this.catalog.planSequence(slug, dto);
    return plans.map((plan) => ({
      start: plan.start,
      end: plan.end,
      professionalIds: [...new Set(plan.segments.map((segment) => segment.professionalId))],
      segments: plan.segments.map((segment) => ({
        serviceId: segment.serviceId,
        serviceName: segment.serviceName,
        professionalId: segment.professionalId,
        professionalName: segment.professionalName,
        start: segment.start,
        end: segment.end,
      })),
    }));
  }

  @Get(':slug')
  spa(@Param('slug') slug: string) {
    return this.catalog.spa(slug);
  }
}
