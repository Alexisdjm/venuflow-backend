import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { AvailabilityService } from './availability.service';
import { PrismaService } from '../../database/prisma/prisma.service';
@ApiTags('Availability')
@ApiBearerAuth()
@Controller('spa/availability')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SPA_ADMIN', 'PROFESSIONAL')
export class AvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly prisma: PrismaService,
  ) {}
  @Get() async get(
    @CurrentUser() u: AuthUser,
    @Query() q: AvailabilityQueryDto,
  ) {
    if (u.role === 'PROFESSIONAL') {
      const professional = await this.prisma.professional.findFirstOrThrow({
        where: { spaId: u.spaId!, userId: u.sub },
      });
      q.professionalId = professional.id;
    }
    return this.availability.get(u.spaId!, q);
  }
}
