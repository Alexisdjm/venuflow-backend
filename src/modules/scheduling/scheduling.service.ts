import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

export const blockingStatus = { not: 'CANCELLED' as const };

export type SpaWindow = {
  timezone: string;
  openingMinute: number;
  closingMinute: number;
  walkInGraceMinutes: number;
};

export type ScheduledSlot = {
  start: DateTime;
  end: DateTime;
  local: DateTime;
  startMinute: number;
  endMinute: number;
  isWalkIn: boolean;
};

type ParsedSlot = {
  start: DateTime;
  end: DateTime;
  local: DateTime;
  localEnd: DateTime;
  startMinute: number;
  endMinute: number;
};

@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  dashboardSlot(
    spa: SpaWindow,
    startAt: string | Date,
    durationMinutes: number,
  ): ScheduledSlot {
    const parsed = parseSlot(spa.timezone, startAt, durationMinutes);
    if (!parsed) throw new BadRequestException('El horario no es válido');
    if (!isAligned(parsed.local))
      throw new BadRequestException(
        'El horario debe caer en un intervalo de 30 minutos',
      );
    const isWalkIn = alreadyStarted(parsed.start);
    if (isWalkIn && pastBeyondGrace(parsed.start, spa.walkInGraceMinutes))
      throw new BadRequestException(
        'No se puede agendar una cita en el pasado',
      );
    if (outsideHours(parsed, spa.openingMinute, spa.closingMinute))
      throw new ConflictException('La cita queda fuera del horario del spa');
    return toSlot(parsed, isWalkIn);
  }

  publicSlot(
    spa: { timezone: string; openingMinute: number; closingMinute: number },
    startAt: string,
    durationMinutes: number,
    continuation = false,
  ): ScheduledSlot {
    const parsed = parseSlot(spa.timezone, startAt, durationMinutes);
    if (!parsed || durationMinutes <= 0)
      throw new BadRequestException('Selecciona un horario válido.');
    if (!parsed.start.isValid || parsed.start.toUTC() <= DateTime.utc())
      throw new BadRequestException('El horario ya pasó.');
    if (!continuation && !isAligned(parsed.local))
      throw new BadRequestException('Selecciona un horario válido.');
    if (outsideHours(parsed, spa.openingMinute, spa.closingMinute))
      throw new ConflictException('El horario está fuera del horario del spa.');
    return toSlot(parsed, false);
  }

  findAssignment(spaId: string, professionalId: string, serviceId: string) {
    return this.prisma.professionalService.findFirst({
      where: {
        spaId,
        professionalId,
        serviceId,
        professional: { isActive: true },
      },
      include: { professional: { select: { commissionRate: true } } },
    });
  }

  shiftCovering(
    spaId: string,
    professionalId: string,
    dayOfWeek: number,
    startMinute: number,
    endMinute: number,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    return client.professionalSchedule.findFirst({
      where: {
        spaId,
        professionalId,
        dayOfWeek,
        isActive: true,
        startMinute: { lte: startMinute },
        endMinute: { gte: endMinute },
      },
    });
  }

  conflictingAppointment(
    input: {
      spaId: string;
      professionalId: string;
      start: Date;
      end: Date;
      excludeIds?: string[];
    },
    client: Prisma.TransactionClient = this.prisma,
  ) {
    return client.appointment.findFirst({
      where: {
        ...excluded(input.excludeIds),
        spaId: input.spaId,
        professionalId: input.professionalId,
        status: blockingStatus,
        startAt: { lt: input.end },
        endAt: { gt: input.start },
      },
    });
  }

  async categoryTaken(
    input: {
      spaId: string;
      customerId: string;
      appointmentDate: Date;
      categoryId: string;
      excludeIds?: string[];
    },
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const row = await client.appointment.findFirst({
      where: {
        ...excluded(input.excludeIds),
        spaId: input.spaId,
        customerId: input.customerId,
        appointmentDate: input.appointmentDate,
        serviceCategoryId: input.categoryId,
        status: blockingStatus,
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  busyBetween(input: {
    spaId: string;
    from: Date;
    until: Date;
    professionalIds?: string[];
    excludeIds?: string[];
  }) {
    return this.prisma.appointment.findMany({
      where: {
        spaId: input.spaId,
        ...excluded(input.excludeIds),
        ...(input.professionalIds
          ? { professionalId: { in: input.professionalIds } }
          : {}),
        status: blockingStatus,
        startAt: { lt: input.until },
        endAt: { gt: input.from },
      },
      select: { professionalId: true, startAt: true, endAt: true },
    });
  }
}

export function alreadyStarted(start: DateTime, now = DateTime.utc()) {
  return start.toUTC() < now;
}

export function pastBeyondGrace(
  start: DateTime,
  graceMinutes: number,
  now = DateTime.utc(),
) {
  return (
    alreadyStarted(start, now) &&
    now.diff(start.toUTC(), 'minutes').minutes > graceMinutes
  );
}

export function notBookableOnline(start: DateTime, now = DateTime.utc()) {
  return !start.isValid || start.toUTC() <= now;
}

export function shiftCovers(
  shift: { startMinute: number; endMinute: number },
  startMinute: number,
  endMinute: number,
) {
  return shift.startMinute <= startMinute && shift.endMinute >= endMinute;
}

export function rangesOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
) {
  return startA < endB && endA > startB;
}

export function professionalBusy(
  appointments: { professionalId: string; startAt: Date; endAt: Date }[],
  professionalId: string,
  start: Date,
  end: Date,
) {
  return appointments.some(
    (appointment) =>
      appointment.professionalId === professionalId &&
      rangesOverlap(appointment.startAt, appointment.endAt, start, end),
  );
}

export function publicStartMinutes(
  openingMinute: number,
  closingMinute: number,
  totalMinutes: number,
) {
  const first = Math.ceil(openingMinute / 30) * 30;
  const last = closingMinute - totalMinutes;
  const minutes: number[] = [];
  for (let minute = first; minute <= last; minute += 30) minutes.push(minute);
  return minutes;
}

export function sequenceStaysOpen(input: {
  start: DateTime;
  localDate: DateTime;
  totalMinutes: number;
  openingMinute: number;
  closingMinute: number;
}) {
  const startMinute = input.start.hour * 60 + input.start.minute;
  const sequenceEnd = input.start.plus({ minutes: input.totalMinutes });
  const sequenceEndMinute = sequenceEnd.hour * 60 + sequenceEnd.minute;
  return (
    input.start.hasSame(input.localDate, 'day') &&
    input.start.minute % 30 === 0 &&
    input.start.second === 0 &&
    input.start.millisecond === 0 &&
    startMinute >= input.openingMinute &&
    sequenceEnd.hasSame(input.start, 'day') &&
    sequenceEndMinute <= input.closingMinute
  );
}

function parseSlot(
  timezone: string,
  startAt: string | Date,
  durationMinutes: number,
): ParsedSlot | null {
  const start =
    typeof startAt === 'string'
      ? DateTime.fromISO(startAt, { setZone: true })
      : DateTime.fromJSDate(startAt);
  if (!start.isValid) return null;
  const local = start.setZone(timezone);
  const end = start.plus({ minutes: durationMinutes });
  const localEnd = end.setZone(timezone);
  return {
    start,
    end,
    local,
    localEnd,
    startMinute: local.hour * 60 + local.minute,
    endMinute: localEnd.hour * 60 + localEnd.minute,
  };
}

function isAligned(local: DateTime) {
  return (
    local.minute % 30 === 0 && local.second === 0 && local.millisecond === 0
  );
}

function outsideHours(
  slot: ParsedSlot,
  openingMinute: number,
  closingMinute: number,
) {
  return (
    !slot.local.hasSame(slot.localEnd, 'day') ||
    slot.startMinute < openingMinute ||
    slot.endMinute > closingMinute
  );
}

function toSlot(slot: ParsedSlot, isWalkIn: boolean): ScheduledSlot {
  return {
    start: slot.start,
    end: slot.end,
    local: slot.local,
    startMinute: slot.startMinute,
    endMinute: slot.endMinute,
    isWalkIn,
  };
}

function excluded(ids?: string[]) {
  if (!ids?.length) return {};
  return ids.length === 1 ? { id: { not: ids[0] } } : { id: { notIn: ids } };
}
