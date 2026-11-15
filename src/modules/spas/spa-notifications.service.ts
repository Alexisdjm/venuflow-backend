import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma/prisma.service';
import { BookingPaymentMaintenance } from '../scheduling/booking-payment-maintenance';
import {
  isPayoutDay,
  minutesUntil,
  payoutCopy,
  reminderUntil,
  type PayoutCadence,
} from './spa-notifications';


@Injectable()
export class SpaNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly holds?: BookingPaymentMaintenance,
  ) {}

  async feed(spaId: string, now = new Date()) {
    if (this.holds) await this.holds.release(spaId);
    const spa = await this.prisma.spa.findUnique({
      where: { id: spaId },
      select: { timezone: true, plan: true, professionalPayoutCadence: true },
    });
    if (!spa) throw new NotFoundException('No se encontró el spa');
    if (!this.holds) {
      await this.prisma.bookingRequest.updateMany({
        where: { spaId, status: 'AWAITING_PAYMENT', expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
    }
    const until = reminderUntil(now);
    const [pending, appointments] = await Promise.all([
      this.prisma.bookingRequest.count({
        where: { spaId, status: 'AWAITING_PAYMENT', expiresAt: { gt: now } },
      }),
      this.prisma.appointment.findMany({
        where: {
          spaId,
          status: 'CONFIRMED',
          isWalkIn: false,
          startAt: { gt: now, lte: until },
          OR: [{ bookingRequest: { isNot: null } }, { visitRequestId: { not: null } }],
        },
        orderBy: { startAt: 'asc' },
        take: 20,
        select: {
          id: true,
          customerName: true,
          startAt: true,
          service: { select: { name: true } },
          professional: { select: { displayName: true } },
        },
      }),
    ]);
    const finance = spa.plan === 'BASIC' || spa.plan === 'PLUS';
    const cadence = spa.professionalPayoutCadence;
    const items = [
      ...(pending > 0
        ? [
            {
              id: 'payment-reviews',
              type: 'PAYMENT_REVIEW' as const,
              title: pending === 1 ? 'Hay 1 solicitud por revisar' : `Hay ${pending} solicitudes por revisar`,
              text: 'Un cliente envió el adelanto y el horario sigue apartado.',
              href: '/dashboard/requests',
              at: now.toISOString(),
            },
          ]
        : []),
      ...appointments.map((appointment) => {
        const when = DateTime.fromJSDate(appointment.startAt, { zone: 'utc' })
          .setZone(spa.timezone)
          .setLocale('es')
          .toFormat('HH:mm');
        const minutes = minutesUntil(appointment.startAt, now);
        return {
          id: `appointment:${appointment.id}`,
          type: 'REMOTE_APPOINTMENT' as const,
          title: `${appointment.customerName} llega en ${minutes} min`,
          text: `${appointment.service.name} con ${appointment.professional.displayName} a las ${when}.`,
          href: '/dashboard/appointments',
          at: appointment.startAt.toISOString(),
        };
      }),
      ...(cadence !== 'NONE' && isPayoutDay(now, spa.timezone, cadence)
        ? [
            {
              id: `payout:${cadence}`,
              type: 'PROFESSIONAL_PAYOUT' as const,
              title: payoutCopy(cadence),
              text: 'Hoy corresponde liquidar las comisiones del periodo.',
              href: finance ? '/dashboard/audit' : null,
              at: now.toISOString(),
            },
          ]
        : []),
    ];
    return {
      cadence: spa.professionalPayoutCadence,
      includesFinance: finance,
      items,
    };
  }

  async updateCadence(spaId: string, cadence: PayoutCadence) {
    const updated = await this.prisma.spa.updateMany({
      where: { id: spaId },
      data: { professionalPayoutCadence: cadence },
    });
    if (!updated.count) throw new NotFoundException('No se encontró el spa');
    return this.feed(spaId);
  }
}

