import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CreateTrialDto } from './dto/create-trial.dto';
import { clientIp } from './trial-ip';
import { TrialService } from './trial.service';

@ApiTags('Trial')
@Controller('public/trial-signups')
export class TrialController {
  constructor(private readonly trials: TrialService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('slug')
  slug(@Query('slug') slug = '') {
    return this.trials.slugAvailable(slug);
  }

  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post()
  create(@Body() dto: CreateTrialDto, @Req() request: Request) {
    return this.trials.create(dto, clientIp(request));
  }
}
