import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../../database/prisma/prisma.service';
import {
  acceptsPublicBookings,
  publicServiceEligibility,
} from '../../../modules/public-booking/public-booking-policy';
import { effectiveCommissionRate } from '../../../modules/services/extra-commission';
import {
  notBookableOnline,
  professionalBusy,
  publicStartMinutes,
  rangesOverlap,
  SchedulingService,
  sequenceStaysOpen,
  shiftCovers,
} from '../../../modules/scheduling/scheduling.service';
import { PublicSequenceAvailabilityDto } from '../../../modules/public-booking/dto/public-sequence.dto';
import { businessCapabilities } from '../../../modules/spas/business-kind';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PublicSequenceSegment = {
  currency?: string;
  timezone?: string;
  serviceId: string;
  serviceName: string;
  categoryId: string;
  professionalId: string;
  professionalName: string;
  commissionRate: string;
  price: string;
  durationMinutes: number;
  start: string;
  end: string;
};

export type PublicSequencePlan = {
  start: string;
  end: string;
  segments: PublicSequenceSegment[];
};

@Injectable()
export class PublicVisitSequenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: SchedulingService,
  ) {}

  async planSequence(
    slug: string,
    dto: PublicSequenceAvailabilityDto & { start?: string },
  ) {
    const spa = await this.findSpa(slug);
    if (!businessCapabilities(spa.kind).visitBundle) {
      throw new BadRequestException('Este negocio reserva un servicio por cita.');
    }
    const ordered = await this.sequenceItems(spa.id, dto.items);
    const shared = dto.sameProfessional
      ? ordered.every((item) => !item.requestedProfessionalId)
        ? undefined
        : ordered.find((item) => item.requestedProfessionalId)
            ?.requestedProfessionalId
      : undefined;
    if (
      dto.sameProfessional &&
      shared &&
      ordered.some(
        (item) =>
          item.requestedProfessionalId &&
          item.requestedProfessionalId !== shared,
      )
    ) {
      throw new BadRequestException(
        'Para una sola profesional, elige la misma en todos los servicios.',
      );
    }
    const items =
      dto.sameProfessional && shared
        ? ordered.map((item) => ({ ...item, requestedProfessionalId: shared }))
        : ordered;
    return this.sequencePlans(
      spa,
      dto.date,
      items,
      Boolean(dto.sameProfessional && !shared),
      dto.start,
    );
  }

  private async sequenceItems(
    spaId: string,
    input: { serviceId: string; professionalId?: string }[],
  ) {
    const rows = await this.prisma.spaService.findMany({
      where: {
        spaId,
        isActive: true,
        id: { in: input.map((item) => item.serviceId) },
      },
      include: { category: true },
    });
    const categories = new Set<string>();
    return input.map((item) => {
      const service = rows.find((row) => row.id === item.serviceId);
      if (!service) throw new NotFoundException('Servicio no encontrado');
      const eligibility = publicServiceEligibility(service);
      if (!eligibility.onlineBookable || service.durationMinutes == null) {
        throw new BadRequestException(
          eligibility.unavailableMessage ??
            'Este servicio no se puede reservar en línea.',
        );
      }
      if (categories.has(service.categoryId)) {
        throw new ConflictException(
          'Una reserva no puede repetir la misma categoría.',
        );
      }
      categories.add(service.categoryId);
      return {
        service,
        durationMinutes: service.durationMinutes,
        requestedProfessionalId:
          item.professionalId && item.professionalId !== 'any'
            ? item.professionalId
            : undefined,
      };
    });
  }

  private async sequencePlans(
    spa: {
      id: string;
      timezone: string;
      openingMinute: number;
      closingMinute: number;
    },
    date: string | undefined,
    items: Awaited<ReturnType<PublicVisitSequenceService['sequenceItems']>>,
    anySingleProfessional: boolean,
    onlyStart?: string,
  ): Promise<PublicSequencePlan[]> {
    const anchor = onlyStart
      ? DateTime.fromISO(onlyStart, { setZone: true }).setZone(spa.timezone)
      : DateTime.fromISO(date ?? '', { zone: spa.timezone });
    const localDate = anchor.startOf('day');
    if (!localDate.isValid)
      throw new BadRequestException('Selecciona una fecha válida.');
    const serviceIds = items.map((item) => item.service.id);
    const assignments = await this.prisma.professionalService.findMany({
      where: {
        spaId: spa.id,
        serviceId: { in: serviceIds },
        professional: { isActive: true },
      },
      include: {
        professional: {
          include: {
            schedules: {
              where: { dayOfWeek: localDate.weekday % 7, isActive: true },
            },
          },
        },
      },
      orderBy: { professional: { displayName: 'asc' } },
    });
    const from = localDate.toUTC().toJSDate();
    const until = localDate.plus({ days: 1 }).toUTC().toJSDate();
    const appointments = [
      ...(await this.scheduling.busyBetween({ spaId: spa.id, from, until })),
      ...(await this.scheduling.paymentHolds(spa.id, from, until)),
    ];
    const total = items.reduce((sum, item) => sum + item.durationMinutes, 0);
    const starts = onlyStart
      ? [DateTime.fromISO(onlyStart, { setZone: true }).setZone(spa.timezone)]
      : publicStartMinutes(spa.openingMinute, spa.closingMinute, total).map(
          (minute) => localDate.plus({ minutes: minute }),
        );
    const capable = anySingleProfessional
      ? [...new Set(assignments.map((item) => item.professionalId))].filter(
          (professionalId) =>
            items.every((item) =>
              assignments.some(
                (assignment) =>
                  assignment.professionalId === professionalId &&
                  assignment.serviceId === item.service.id,
              ),
            ),
        )
      : [];
    const build = (start: DateTime, forcedProfessionalId?: string) => {
      if (notBookableOnline(start)) return null;
      if (
        !sequenceStaysOpen({
          start,
          localDate,
          totalMinutes: total,
          openingMinute: spa.openingMinute,
          closingMinute: spa.closingMinute,
        })
      )
        return null;
      let cursor = start;
      const placed: PublicSequenceSegment[] = [];
      for (const item of items) {
        const end = cursor.plus({ minutes: item.durationMinutes });
        const segmentStart = cursor.hour * 60 + cursor.minute;
        const segmentEnd = end.hour * 60 + end.minute;
        const requested = forcedProfessionalId ?? item.requestedProfessionalId;
        const assignment = assignments.find(
          (candidate) =>
            candidate.serviceId === item.service.id &&
            (!requested || candidate.professionalId === requested) &&
            candidate.professional.schedules.some((schedule) =>
              shiftCovers(schedule, segmentStart, segmentEnd),
            ) &&
            !professionalBusy(
              appointments,
              candidate.professionalId,
              cursor.toUTC().toJSDate(),
              end.toUTC().toJSDate(),
            ) &&
            !placed.some(
              (segment) =>
                segment.professionalId === candidate.professionalId &&
                rangesOverlap(
                  new Date(segment.start),
                  new Date(segment.end),
                  cursor.toUTC().toJSDate(),
                  end.toUTC().toJSDate(),
                ),
            ),
        );
        if (!assignment || !end.hasSame(cursor, 'day')) return null;
        placed.push({
          serviceId: item.service.id,
          serviceName: item.service.name,
          categoryId: item.service.categoryId,
          professionalId: assignment.professionalId,
          professionalName: assignment.professional.displayName,
          commissionRate: effectiveCommissionRate(
            assignment.professional.commissionRate,
            item.service,
          ).toString(),
          price: item.service.price.toString(),
          durationMinutes: item.durationMinutes,
          start: cursor.toUTC().toISO()!,
          end: end.toUTC().toISO()!,
        });
        cursor = end;
      }
      return {
        start: start.toUTC().toISO()!,
        end: cursor.toUTC().toISO()!,
        segments: placed,
      };
    };
    return starts.flatMap((start) => {
      if (!anySingleProfessional) {
        const plan = build(start);
        return plan ? [plan] : [];
      }
      for (const professionalId of capable) {
        const plan = build(start, professionalId);
        if (plan) return [plan];
      }
      return [];
    });
  }

  private async findSpa(slug: string) {
    if (!SLUG.test(slug)) throw new NotFoundException('Spa no encontrado');
    const spa = await this.prisma.spa.findUnique({ where: { slug } });
    if (!acceptsPublicBookings(spa))
      throw new NotFoundException('Spa no encontrado');
    return spa;
  }
}
