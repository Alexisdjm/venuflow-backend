import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';

export interface AuditEvent {
  actorUserId?: string | null;
  spaId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  record(event: AuditEvent) {
    return this.prisma.auditLog.create({ data: event });
  }
  async list(spaId: string | undefined, query: PaginationDto) {
    const where = spaId === undefined ? {} : { spaId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total } };
  }
}
