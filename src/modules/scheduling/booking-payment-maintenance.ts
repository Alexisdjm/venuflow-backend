import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PaymentProofStore } from '../public-booking/payment-proof.store';

export const PROOF_RETENTION_DAYS = 45;
const PURGE_BATCH = 25;

@Injectable()
export class BookingPaymentMaintenance {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly proofs: PaymentProofStore,
  ) {}

  async release(spaId: string) {
    await this.expireHolds(spaId);
    await this.purgeProofs(spaId);
  }

  private async expireHolds(spaId: string) {
    const now = new Date();
    const due = await this.prisma.bookingRequest.findMany({
      where: { spaId, status: 'AWAITING_PAYMENT', expiresAt: { lte: now } },
      select: {
        id: true,
        email: true,
        submittedName: true,
        startAt: true,
        paymentProofPath: true,
        spa: { select: { name: true, timezone: true } },
        service: { select: { name: true } },
        professional: { select: { displayName: true } },
      },
    });
    for (const request of due) {
      const claimed = await this.prisma.bookingRequest.updateMany({
        where: { id: request.id, spaId, status: 'AWAITING_PAYMENT', expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
      if (claimed.count !== 1) continue;
      await this.clearProof(request.id, request.paymentProofPath);
      await this.mail.sendBookingPaymentExpired({
        to: request.email,
        customerName: request.submittedName,
        spaName: request.spa.name,
        serviceName: request.service.name,
        professionalName: request.professional?.displayName ?? 'Según disponibilidad',
        when: DateTime.fromJSDate(request.startAt, { zone: 'utc' })
          .setZone(request.spa.timezone)
          .setLocale('es')
          .toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY),
        reference: 'El tiempo de revisión terminó y el horario quedó libre.',
      }).catch(() => undefined);
    }
  }

  private async purgeProofs(spaId: string) {
    const cutoff = new Date(Date.now() - PROOF_RETENTION_DAYS * 24 * 60 * 60_000);
    const stale = await this.prisma.bookingRequest.findMany({
      where: {
        spaId,
        paymentProofPath: { not: null },
        paymentSubmittedAt: { lt: cutoff },
        status: { in: ['CONFIRMED', 'CANCELLED', 'REJECTED', 'EXPIRED'] },
      },
      select: { id: true, paymentProofPath: true },
      take: PURGE_BATCH,
    });
    for (const request of stale) {
      await this.clearProof(request.id, request.paymentProofPath);
    }
  }

  private async clearProof(requestId: string, stored: string | null) {
    if (!stored) return;
    await this.proofs.remove(stored).catch(() => undefined);
    await this.prisma.bookingRequest.updateMany({
      where: { id: requestId, paymentProofPath: stored },
      data: { paymentProofPath: null, paymentProofMime: null, paymentProofBytes: null },
    });
  }
}
