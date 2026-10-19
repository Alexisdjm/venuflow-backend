import { Module } from '@nestjs/common';
import { PlatformSpasController } from './platform-spas.controller';
import { SpaAdminController } from './spa-admin.controller';
import { SpasService } from './spas.service';
import { UsersModule } from '../users/users.module';
import { ProfessionalsModule } from '../professionals/professionals.module';
@Module({
  imports: [UsersModule, ProfessionalsModule],
  controllers: [PlatformSpasController, SpaAdminController],
  providers: [SpasService],
})
export class SpasModule {}
