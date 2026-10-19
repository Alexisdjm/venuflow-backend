import { Module } from '@nestjs/common';
import { ProfessionalsService } from './professionals.service';
@Module({ providers: [ProfessionalsService], exports: [ProfessionalsService] })
export class ProfessionalsModule {}
