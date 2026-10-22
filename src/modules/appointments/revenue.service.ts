import { BadRequestException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma/prisma.service';
import { RevenueQueryDto } from './dto/revenue-query.dto';

@Injectable()
export class RevenueService {
  constructor(private readonly prisma: PrismaService) {}

  async get(spaId: string, query: RevenueQueryDto) {
    const spa = await this.prisma.spa.findUniqueOrThrow({
      where: { id: spaId },
    });
    const reference = query.date
      ? DateTime.fromISO(query.date, { zone: spa.timezone })
      : DateTime.now().setZone(spa.timezone);
    if (!reference.isValid) throw new BadRequestException('Invalid date');
    const period = query.period ?? 'day';
    const start =
      period === 'week'
        ? reference.startOf('week')
        : period === 'month'
          ? reference.startOf('month')
          : reference.startOf('day');
    const end =
      period === 'week'
        ? start.plus({ weeks: 1 })
        : period === 'month'
          ? start.plus({ months: 1 })
          : start.plus({ days: 1 });
    const appointments = await this.prisma.appointment.findMany({
      where: {
        spaId,
        status: 'COMPLETED',
        startAt: { gte: start.toUTC().toJSDate(), lt: end.toUTC().toJSDate() },
      },
      include: {
        professional: { select: { id: true, displayName: true } },
        service: { select: { id: true, name: true } },
      },
      orderBy: { startAt: 'asc' },
    });
    const buckets = new Map<string, number>();
    const professionals = new Map<
      string,
      {
        professionalId: string;
        name: string;
        gross: number;
        commission: number;
        appointments: number;
        services: Map<
          string,
          {
            serviceId: string;
            name: string;
            gross: number;
            commission: number;
            appointments: number;
          }
        >;
      }
    >();
    let gross = 0,
      commissions = 0;
    for (const appointment of appointments) {
      const price = Number(appointment.servicePrice);
      const commission = (price * Number(appointment.commissionRate)) / 100;
      gross += price;
      commissions += commission;
      const local = DateTime.fromJSDate(appointment.startAt).setZone(
        spa.timezone,
      );
      const key =
        period === 'day'
          ? local.toFormat('HH:00')
          : period === 'week'
            ? local.toFormat('ccc dd')
            : local.toFormat('dd');
      buckets.set(key, (buckets.get(key) ?? 0) + price);
      const row = professionals.get(appointment.professionalId) ?? {
        professionalId: appointment.professionalId,
        name: appointment.professional.displayName,
        gross: 0,
        commission: 0,
        appointments: 0,
        services: new Map(),
      };
      row.gross += price;
      row.commission += commission;
      row.appointments += 1;
      const service = row.services.get(appointment.serviceId) ?? {
        serviceId: appointment.serviceId,
        name: appointment.service.name,
        gross: 0,
        commission: 0,
        appointments: 0,
      };
      service.gross += price;
      service.commission += commission;
      service.appointments += 1;
      row.services.set(appointment.serviceId, service);
      professionals.set(appointment.professionalId, row);
    }
    return {
      period,
      currency: spa.currency,
      timezone: spa.timezone,
      range: {
        start: start.toISODate(),
        end: end.minus({ days: 1 }).toISODate(),
      },
      totals: {
        gross,
        commissions,
        net: gross - commissions,
        appointments: appointments.length,
      },
      series: [...buckets].map(([label, amount]) => ({ label, amount })),
      professionals: [...professionals.values()]
        .map(({ services, ...row }) => ({
          ...row,
          services: [...services.values()],
        }))
        .sort((a, b) => b.gross - a.gross),
    };
  }
}
