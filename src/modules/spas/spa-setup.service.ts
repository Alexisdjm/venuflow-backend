import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';

export type SpaSetupStatus = {
  visible: boolean;
  payments: boolean;
  deposit: boolean;
  schedules: boolean;
  assignments: boolean;
  teamAccess: boolean | null;
};

@Injectable()
export class SpaSetupService {
  constructor(private readonly prisma: PrismaService) {}

  async get(spaId: string): Promise<SpaSetupStatus> {
    const spa = await this.prisma.spa.findUnique({
      where: { id: spaId },
      select: { plan: true, remoteDepositMode: true },
    });
    if (!spa) throw new NotFoundException('Spa no encontrado');
    if (spa.plan !== 'DEMO') {
      return {
        visible: false,
        payments: false,
        deposit: false,
        schedules: false,
        assignments: false,
        teamAccess: null,
      };
    }

    const [payments, professionals, activeServices, unassignedServices, depositDecision] =
      await Promise.all([
        this.prisma.spaPaymentMethod.count({ where: { spaId } }),
        this.prisma.professional.findMany({
          where: { spaId, isActive: true },
          select: {
            userId: true,
            user: { select: { role: true } },
            schedules: { where: { isActive: true }, select: { id: true }, take: 1 },
            services: { select: { serviceId: true }, take: 1 },
          },
        }),
        this.prisma.spaService.count({ where: { spaId, isActive: true } }),
        this.prisma.spaService.count({
          where: {
            spaId,
            isActive: true,
            professionals: { none: { professional: { isActive: true } } },
          },
        }),
        this.prisma.auditLog.findFirst({
          where: { spaId, action: 'SPA_BOOKING_PAYMENTS_UPDATED' },
          select: { id: true },
        }),
      ]);

    const extras = professionals.filter((person) => person.user.role === 'PROFESSIONAL');
    const granted = extras.length
      ? await this.prisma.auditLog.findMany({
          where: {
            spaId,
            action: 'PROFESSIONAL_PASSWORD_RESET',
            entityId: { in: extras.map((person) => person.userId) },
          },
          select: { entityId: true },
        })
      : [];
    const grantedIds = new Set(granted.map((event) => event.entityId));

    return {
      visible: true,
      payments: payments > 0,
      deposit: spa.remoteDepositMode !== 'NONE' || Boolean(depositDecision),
      schedules:
        professionals.length > 0 && professionals.every((person) => person.schedules.length > 0),
      assignments:
        activeServices > 0 &&
        unassignedServices === 0 &&
        professionals.length > 0 &&
        professionals.every((person) => person.services.length > 0),
      teamAccess:
        extras.length === 0
          ? null
          : extras.every((person) => grantedIds.has(person.userId)),
    };
  }
}
