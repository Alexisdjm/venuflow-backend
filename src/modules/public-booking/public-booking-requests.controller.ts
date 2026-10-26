import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreatePublicBookingDto } from './dto/create-public-booking.dto';
import { PublicBookingRequestsService } from './public-booking-requests.service';

@ApiTags('Public booking')
@Controller('public')
export class PublicBookingRequestsController {
  constructor(private readonly requests: PublicBookingRequestsService) {}

  @Post('booking-requests')
  create(@Body() dto: CreatePublicBookingDto) {
    return this.requests.create(dto);
  }

  @Post('booking-requests/:id/resend')
  resend(@Param('id') id: string) {
    return this.requests.resend(id);
  }

  @Get('booking-verifications/:token')
  details(@Param('token') token: string) {
    return this.requests.details(token);
  }

  @Post('booking-verifications/:token/confirm')
  confirm(
    @Param('token') token: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.requests.confirm(token, idempotencyKey);
  }

  @Post('booking-verifications/:token/cancel')
  cancel(@Param('token') token: string) {
    return this.requests.cancel(token);
  }

  @Get('booking-confirmations/:token')
  confirmation(@Param('token') token: string) {
    return this.requests.confirmation(token);
  }

  @Post('booking-confirmations/:token/cancel')
  cancelConfirmed(@Param('token') token: string) {
    return this.requests.cancelConfirmed(token);
  }
}
