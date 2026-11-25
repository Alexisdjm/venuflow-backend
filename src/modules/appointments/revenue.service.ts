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
    if (!reference.isValid) throw new BadRequestException('La fecha no es válida');
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
    const rangeStart = start.toUTC().toJSDate();
    const rangeEnd = end.toUTC().toJSDate();
    const [appointments, packagePayments] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          spaId,
          status: 'COMPLETED',
          customerPackageId: null,
          startAt: { gte: rangeStart, lt: rangeEnd },
        },
        include: {
          professional: { select: { id: true, displayName: true } },
          service: { select: { id: true, name: true } },
        },
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.packagePayment.findMany({
        where: { spaId, createdAt: { gte: rangeStart, lt: rangeEnd } },
        include: {
          customerPackage: {
            select: {
              name: true,
              service: { select: { id: true, name: true } },
              appointments: {
                orderBy: { startAt: 'asc' },
                take: 1,
                select: {
                  commissionRate: true,
                  professional: { select: { id: true, displayName: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
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
      commissions = 0,
      sales = 0;
    const addSale = (sale: {
      at: Date;
      price: number;
      commissionRate: number;
      professionalId?: string;
      professionalName?: string;
      serviceId: string;
      serviceName: string;
    }) => {
      const commission = (sale.price * sale.commissionRate) / 100;
      gross += sale.price;
      commissions += commission;
      sales += 1;
      const local = DateTime.fromJSDate(sale.at).setZone(spa.timezone);
      const key =
        period === 'day'
          ? local.toFormat('HH:00')
          : period === 'week'
            ? local.toFormat('ccc dd')
            : local.toFormat('dd');
      buckets.set(key, (buckets.get(key) ?? 0) + sale.price);
      if (!sale.professionalId || !sale.professionalName) return;
      const row = professionals.get(sale.professionalId) ?? {
        professionalId: sale.professionalId,
        name: sale.professionalName,
        gross: 0,
        commission: 0,
        appointments: 0,
        services: new Map(),
      };
      row.gross += sale.price;
      row.commission += commission;
      row.appointments += 1;
      const service = row.services.get(sale.serviceId) ?? {
        serviceId: sale.serviceId,
        name: sale.serviceName,
        gross: 0,
        commission: 0,
        appointments: 0,
      };
      service.gross += sale.price;
      service.commission += commission;
      service.appointments += 1;
      row.services.set(sale.serviceId, service);
      professionals.set(sale.professionalId, row);
    };
    for (const appointment of appointments) {
      addSale({
        at: appointment.startAt,
        price: Number(appointment.servicePrice),
        commissionRate: Number(appointment.commissionRate),
        professionalId: appointment.professionalId,
        professionalName: appointment.professional.displayName,
        serviceId: appointment.serviceId,
        serviceName: appointment.service.name,
      });
    }
    for (const payment of packagePayments) {
      const pack = payment.customerPackage;
      const session = pack.appointments[0];
      addSale({
        at: payment.createdAt,
        price: Number(payment.amount),
        commissionRate: session ? Number(session.commissionRate) : 0,
        professionalId: session?.professional.id,
        professionalName: session?.professional.displayName,
        serviceId: pack.service.id,
        serviceName: pack.service.name,
      });
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
        appointments: sales,
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
