import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { AvailabilityService } from '../availability/availability.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { PublicAvailabilityQueryDto } from './dto/public-availability.dto';
import { PublicSequenceAvailabilityDto } from './dto/public-sequence.dto';

export type PublicSequenceSegment = {
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

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
export class PublicBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  async spa(slug: string) {
    const spa = await this.findSpa(slug);
    return {
      id: spa.id,
      slug: spa.slug,
      name: spa.name,
      timezone: spa.timezone,
      currency: spa.currency,
    };
  }

  async services(slug: string) {
    const spa = await this.findSpa(slug);
    const rows = await this.prisma.spaService.findMany({
      where: { spaId: spa.id, isActive: true },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
      include: { category: { select: { id: true, name: true } } },
    });
    return rows.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description ?? '',
      category: service.category.name,
      durationMinutes: service.durationMinutes,
      price: Number(service.price.toString()),
      priceFrom: service.priceType === 'VARIABLE',
      mode: service.durationType === 'VARIABLE' ? 'ESTIMATED' : 'INSTANT',
      compatibleWith: rows
        .filter((other) => other.categoryId !== service.categoryId)
        .map((other) => other.id),
    }));
  }

  async professionals(slug: string, serviceIds: string) {
    const spa = await this.findSpa(slug);
    const ids = this.ids(serviceIds);
    if (ids.length) {
      const found = await this.prisma.spaService.count({
        where: { spaId: spa.id, isActive: true, id: { in: ids } },
      });
      if (found !== ids.length) throw new NotFoundException('Servicio no encontrado');
    }
    const rows = await this.prisma.professional.findMany({
      where: {
        spaId: spa.id,
        isActive: true,
        ...(ids.length
          ? { AND: ids.map((serviceId) => ({ services: { some: { serviceId } } })) }
          : {}),
      },
      orderBy: { displayName: 'asc' },
      include: {
        services: {
          include: { service: { select: { category: { select: { name: true } } } } },
        },
      },
    });
    const listed = rows.map((professional) => {
      const categories = [
        ...new Set(professional.services.map((item) => item.service.category.name)),
      ];
      return {
        id: professional.id,
        name: professional.displayName,
        specialty: categories.join(' · ') || 'Profesional',
        serviceIds: professional.services.map((item) => item.serviceId),
        initials: initials(professional.displayName),
      };
    });
    return [
      {
        id: 'any',
        name: 'Cualquier profesional',
        specialty: 'Asignación según disponibilidad',
        serviceIds: ids,
        initials: 'VF',
      },
      ...listed,
    ];
  }

  async availability(slug: string, query: PublicAvailabilityQueryDto) {
    const spa = await this.findSpa(slug);
    const ids = this.ids(query.serviceIds);
    const services = await this.prisma.spaService.findMany({
      where: { spaId: spa.id, isActive: true, id: { in: ids } },
    });
    if (services.length !== ids.length)
      throw new NotFoundException('Servicio no encontrado');
    if (services.some((service) => service.durationType === 'VARIABLE' || service.durationMinutes == null))
      throw new BadRequestException(
        'Hay un servicio con duración variable. Elige uno de duración fija para ver horarios.',
      );
    if (services.length !== 1)
      throw new BadRequestException(
        'La disponibilidad combinada de varias categorías todavía no está disponible en la reserva pública.',
      );
    const result = await this.availabilityService.get(spa.id, {
      date: query.date,
      serviceId: services[0].id,
      professionalId: query.professionalId,
      intervalMinutes: 30,
    });
    const slots = new Map<string, { start: string; end: string; professionalIds: string[] }>();
    for (const slot of result.data) {
      if (!slot.start || !slot.end) continue;
      const current = slots.get(slot.start);
      if (current) current.professionalIds.push(slot.professionalId);
      else slots.set(slot.start, { start: slot.start, end: slot.end, professionalIds: [slot.professionalId] });
    }
    return [...slots.values()];
  }

  async planSequence(slug: string, dto: PublicSequenceAvailabilityDto & { start?: string }) {
    const spa = await this.findSpa(slug);
    const ordered = await this.sequenceItems(spa.id, dto.items);
    const shared = dto.sameProfessional
      ? ordered.every((item) => !item.requestedProfessionalId)
        ? undefined
        : ordered.find((item) => item.requestedProfessionalId)?.requestedProfessionalId
      : undefined;
    if (
      dto.sameProfessional &&
      shared &&
      ordered.some((item) => item.requestedProfessionalId && item.requestedProfessionalId !== shared)
    ) {
      throw new BadRequestException('Para una sola profesional, elige la misma en todos los servicios.');
    }
    const items = dto.sameProfessional && shared
      ? ordered.map((item) => ({ ...item, requestedProfessionalId: shared }))
      : ordered;
    return this.sequencePlans(spa, dto.date, items, Boolean(dto.sameProfessional && !shared), dto.start);
  }

  private async sequenceItems(
    spaId: string,
    input: { serviceId: string; professionalId?: string }[],
  ) {
    const rows = await this.prisma.spaService.findMany({
      where: { spaId, isActive: true, id: { in: input.map((item) => item.serviceId) } },
      include: { category: true },
    });
    const categories = new Set<string>();
    return input.map((item) => {
      const service = rows.find((row) => row.id === item.serviceId);
      if (!service) throw new NotFoundException('Servicio no encontrado');
      if (service.durationType !== 'FIXED' || service.durationMinutes == null || service.priceType !== 'FIXED') {
        throw new BadRequestException('Este servicio se confirma en el spa porque su duración o precio no es fijo.');
      }
      if (categories.has(service.categoryId)) {
        throw new ConflictException('Una reserva no puede repetir la misma categoría.');
      }
      categories.add(service.categoryId);
      return {
        service,
        durationMinutes: service.durationMinutes,
        requestedProfessionalId: item.professionalId && item.professionalId !== 'any' ? item.professionalId : undefined,
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
    items: Awaited<ReturnType<PublicBookingService['sequenceItems']>>,
    anySingleProfessional: boolean,
    onlyStart?: string,
  ): Promise<PublicSequencePlan[]> {
    const anchor = onlyStart
      ? DateTime.fromISO(onlyStart, { setZone: true }).setZone(spa.timezone)
      : DateTime.fromISO(date ?? '', { zone: spa.timezone });
    const localDate = anchor.startOf('day');
    if (!localDate.isValid) throw new BadRequestException('Selecciona una fecha válida.');
    const serviceIds = items.map((item) => item.service.id);
    const assignments = await this.prisma.professionalService.findMany({
      where: { spaId: spa.id, serviceId: { in: serviceIds }, professional: { isActive: true } },
      include: {
        professional: {
          include: { schedules: { where: { dayOfWeek: localDate.weekday % 7, isActive: true } } },
        },
      },
      orderBy: { professional: { displayName: 'asc' } },
    });
    const appointments = await this.prisma.appointment.findMany({
      where: {
        spaId: spa.id,
        status: { not: 'CANCELLED' },
        startAt: { lt: localDate.plus({ days: 1 }).toUTC().toJSDate() },
        endAt: { gt: localDate.toUTC().toJSDate() },
      },
      select: { professionalId: true, startAt: true, endAt: true },
    });
    const total = items.reduce((sum, item) => sum + item.durationMinutes, 0);
    const now = DateTime.utc();
    const starts = onlyStart
      ? [DateTime.fromISO(onlyStart, { setZone: true }).setZone(spa.timezone)]
      : Array.from(
          { length: Math.floor((spa.closingMinute - spa.openingMinute - total) / 30) + 1 },
          (_, index) => localDate.plus({ minutes: spa.openingMinute + index * 30 }),
        );
    const capable = anySingleProfessional
      ? [...new Set(assignments.map((item) => item.professionalId))].filter((professionalId) =>
          items.every((item) =>
            assignments.some((assignment) => assignment.professionalId === professionalId && assignment.serviceId === item.service.id),
          ),
        )
      : [];
    const build = (start: DateTime, forcedProfessionalId?: string) => {
      if (!start.isValid || start.toUTC() <= now) return null;
      const startMinute = start.hour * 60 + start.minute;
      const sequenceEnd = start.plus({ minutes: total });
      const sequenceEndMinute = sequenceEnd.hour * 60 + sequenceEnd.minute;
      if (
        !start.hasSame(localDate, 'day') ||
        start.minute % 30 !== 0 ||
        start.second !== 0 ||
        start.millisecond !== 0 ||
        startMinute < spa.openingMinute ||
        !sequenceEnd.hasSame(start, 'day') ||
        sequenceEndMinute > spa.closingMinute
      ) return null;
      let cursor = start;
      const placed: PublicSequenceSegment[] = [];
      for (const item of items) {
        const end = cursor.plus({ minutes: item.durationMinutes });
        const segmentStart = cursor.hour * 60 + cursor.minute;
        const segmentEnd = end.hour * 60 + end.minute;
        const requested = forcedProfessionalId ?? item.requestedProfessionalId;
        const assignment = assignments.find((candidate) =>
          candidate.serviceId === item.service.id &&
          (!requested || candidate.professionalId === requested) &&
          candidate.professional.schedules.some((schedule) => schedule.startMinute <= segmentStart && schedule.endMinute >= segmentEnd) &&
          !appointments.some((appointment) =>
            appointment.professionalId === candidate.professionalId &&
            appointment.startAt < end.toUTC().toJSDate() &&
            appointment.endAt > cursor.toUTC().toJSDate(),
          ) &&
          !placed.some((segment) =>
            segment.professionalId === candidate.professionalId &&
            new Date(segment.start) < end.toUTC().toJSDate() &&
            new Date(segment.end) > cursor.toUTC().toJSDate(),
          ),
        );
        if (!assignment || !end.hasSame(cursor, 'day')) return null;
        placed.push({
          serviceId: item.service.id,
          serviceName: item.service.name,
          categoryId: item.service.categoryId,
          professionalId: assignment.professionalId,
          professionalName: assignment.professional.displayName,
          commissionRate: assignment.professional.commissionRate.toString(),
          price: item.service.price.toString(),
          durationMinutes: item.durationMinutes,
          start: cursor.toUTC().toISO()!,
          end: end.toUTC().toISO()!,
        });
        cursor = end;
      }
      return { start: start.toUTC().toISO()!, end: cursor.toUTC().toISO()!, segments: placed };
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

  private ids(value: string) {
    return value.split(',').map((id) => id.trim()).filter(Boolean);
  }

  private async findSpa(slug: string) {
    if (!SLUG.test(slug)) throw new NotFoundException('Spa no encontrado');
    const spa = await this.prisma.spa.findUnique({ where: { slug } });
    if (!spa || spa.status !== 'ACTIVE') throw new NotFoundException('Spa no encontrado');
    return spa;
  }
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'P';
}
