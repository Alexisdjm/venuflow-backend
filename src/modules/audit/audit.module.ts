import { Global, Module } from '@nestjs/common';
import {
  PlatformAuditController,
  SpaAuditController,
} from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [PlatformAuditController, SpaAuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
