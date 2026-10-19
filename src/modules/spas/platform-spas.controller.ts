import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { SpasService } from './spas.service';
import { CreateSpaDto, UpdateSpaDto } from './dto/spa.dto';
import { ProvisionAdminDto } from './dto/provision-admin.dto';
@ApiTags('Platform')
@ApiBearerAuth()
@Controller('platform/spas')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('PLATFORM_ADMIN')
export class PlatformSpasController {
  constructor(private readonly spas: SpasService) {}
  @Post() create(@Body() d: CreateSpaDto) {
    return this.spas.create(d);
  }
  @Get() list(@Query() q: PaginationDto) {
    return this.spas.list(q);
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.spas.get(id);
  }
  @Patch(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: UpdateSpaDto,
  ) {
    return this.spas.update(id, d);
  }
  @Post(':id/admin') admin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: ProvisionAdminDto,
  ) {
    return this.spas.provisionAdmin(id, d);
  }
}
