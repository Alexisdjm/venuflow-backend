import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfessionalsModule } from '../professionals/professionals.module';
import { MeController } from './me.controller';
@Module({
  imports: [AuthModule, ProfessionalsModule],
  controllers: [MeController],
})
export class ProfileModule {}
