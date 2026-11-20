import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma/prisma.service';

@Injectable()
export class PackageInactivityService {
  constructor(private readonly prisma: PrismaService) {}

  async sweep(spaId: string) {
    const spa = await this.prisma.spa.findUnique({
      where: { id: spaId },
      select: { timezone: true },
    });
    if (!spa) return;
    const packs = await this.prisma.customerPackage.findMany({
      where: { spaId, cancelledAt: null, inactivityDays: { not: null } },
      select: {
        id: true,
        inactivityDays: true,
        appointments: {
          where: { status: { in: ['COMPLETED', 'CONFIRMED'] } },
          select: { status: true, endAt: true },
        },
      },
    });
    const now = DateTime.now().setZone(spa.timezone);
    const expired = packs.filter((pack) => {
      const completed = pack.appointments.filter((item) => item.status === 'COMPLETED');
      if (!completed.length || !pack.inactivityDays) return false;
      const last = completed.reduce((latest, item) =>
        item.endAt > latest ? item.endAt : latest,
      completed[0].endAt);
      const deadline = DateTime.fromJSDate(last, { zone: spa.timezone })
        .plus({ days: pack.inactivityDays })
        .endOf('day');
      return now > deadline;
    });
    if (!expired.length) return;
    const ids = expired.map((pack) => pack.id);
    await this.prisma.$transaction([
      this.prisma.appointment.updateMany({
        where: { spaId, customerPackageId: { in: ids }, status: 'CONFIRMED' },
        data: { status: 'CANCELLED' },
      }),
      this.prisma.customerPackage.updateMany({
        where: { spaId, id: { in: ids } },
        data: { cancelledAt: new Date() },
      }),
    ]);
  }
}
