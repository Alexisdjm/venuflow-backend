import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CreatePublicBookingDto } from './dto/create-public-booking.dto';
import { PublicBookingRequestsService } from './public-booking-requests.service';

const publicRead = { default: { limit: 60, ttl: 60_000 } };
const publicWrite = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Public booking')
@Controller('public')
export class PublicBookingRequestsController {
  constructor(private readonly requests: PublicBookingRequestsService) {}

  @Throttle(publicWrite)
  @Post('booking-requests')
  create(@Body() dto: CreatePublicBookingDto) {
    return this.requests.create(dto);
  }

  @Throttle(publicWrite)
  @Post('booking-requests/:id/resend')
  resend(@Param('id') id: string) {
    return this.requests.resend(id);
  }

  @Throttle(publicRead)
  @Get('booking-verifications/:token')
  details(@Param('token') token: string) {
    return this.requests.details(token);
  }

  @Throttle(publicWrite)
  @Post('booking-verifications/:token/confirm')
  confirm(
    @Param('token') token: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.requests.confirm(token, idempotencyKey);
  }

  @Throttle(publicWrite)
  @Post('booking-verifications/:token/cancel')
  cancel(@Param('token') token: string) {
    return this.requests.cancel(token);
  }

  @Throttle(publicRead)
  @Get('booking-confirmations/:token')
  confirmation(@Param('token') token: string) {
    return this.requests.confirmation(token);
  }

  @Throttle(publicWrite)
  @Post('booking-confirmations/:token/cancel')
  cancelConfirmed(@Param('token') token: string) {
    return this.requests.cancelConfirmed(token);
  }
}
