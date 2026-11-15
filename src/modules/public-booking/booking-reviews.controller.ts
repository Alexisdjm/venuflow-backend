import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PublicBookingRequestsService } from './public-booking-requests.service';

@ApiTags('Booking reviews')
@ApiBearerAuth()
@Controller('spa/booking-requests')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SPA_ADMIN')
export class BookingReviewsController {
  constructor(private readonly requests: PublicBookingRequestsService) {}

  @Get('count')
  count(@CurrentUser() user: AuthUser) {
    return this.requests.reviewCount(this.tenant(user));
  }

  @Get()
  queue(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) {
    return this.requests.reviewQueue(this.tenant(user), query.page, query.limit);
  }

  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Get(':id/proof')
  async proof(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const file = await this.requests.reviewProof(this.tenant(user), id);
    return new StreamableFile(file.bytes, {
      type: file.mime,
      disposition: 'inline',
      length: file.bytes.length,
    });
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.approvePayment(user.sub, this.tenant(user), id);
  }

  @Post(':id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.rejectPayment(user.sub, this.tenant(user), id);
  }

  private tenant(user: AuthUser) {
    if (!user.spaId) throw new ForbiddenException();
    return user.spaId;
  }
}
