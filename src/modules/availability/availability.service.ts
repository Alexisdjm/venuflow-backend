import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}
  async get(spaId: string, q: AvailabilityQueryDto) {
    const spa = await this.prisma.spa.findUniqueOrThrow({
      where: { id: spaId },
    });
    const service = await this.prisma.spaService.findUnique({
      where: { id_spaId: { id: q.serviceId, spaId } },
    });
    if (!service || !service.isActive)
      throw new NotFoundException('No se encontró el servicio');
    const durationMinutes =
      service.durationType === 'VARIABLE'
        ? q.durationMinutes
        : service.durationMinutes;
    if (durationMinutes === undefined || durationMinutes === null)
      throw new BadRequestException(
        'Indica la duración del servicio',
      );
    if (durationMinutes > spa.closingMinute - spa.openingMinute)
      throw new BadRequestException(
        'La duración supera el horario del spa',
      );
    const localDate = DateTime.fromISO(q.date, { zone: spa.timezone }).startOf(
      'day',
    );
    if (!localDate.isValid) throw new NotFoundException('La fecha no es válida');
    const dayOfWeek = localDate.weekday % 7;
    const assignments = await this.prisma.professionalService.findMany({
      where: {
        spaId,
        serviceId: service.id,
        professionalId: q.professionalId,
        professional: { isActive: true },
      },
      include: {
        professional: {
          include: {
            schedules: {
              where: { dayOfWeek, isActive: true },
              orderBy: { startMinute: 'asc' },
            },
          },
        },
      },
    });
    const dayEnd = localDate.plus({ days: 1 });
    const now = DateTime.now().setZone(spa.timezone);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        spaId,
        status: { not: 'CANCELLED' },
        startAt: { lt: dayEnd.toUTC().toJSDate() },
        endAt: { gt: localDate.toUTC().toJSDate() },
      },
      select: { professionalId: true, startAt: true, endAt: true },
    });
    const data = assignments.flatMap(({ professional }) =>
      professional.schedules.flatMap((schedule) => {
        const slots = [];
        for (
          let minute = schedule.startMinute;
          minute + durationMinutes <= schedule.endMinute;
          minute += q.intervalMinutes
        ) {
          const start = localDate.plus({ minutes: minute });
          const end = start.plus({ minutes: durationMinutes });
          const isGracePeriod = start < now;
          if (
            isGracePeriod &&
            now.diff(start, 'minutes').minutes > spa.walkInGraceMinutes
          )
            continue;
          const occupied = appointments.some(
            (appointment) =>
              appointment.professionalId === professional.id &&
              appointment.startAt < end.toJSDate() &&
              appointment.endAt > start.toJSDate(),
          );
          if (!occupied)
            slots.push({
              professionalId: professional.id,
              serviceId: service.id,
              start: start.toUTC().toISO(),
              end: end.toUTC().toISO(),
              localStart: start.toISO(),
              localEnd: end.toISO(),
              isGracePeriod,
            });
        }
        return slots;
      }),
    );
    return {
      date: q.date,
      timezone: spa.timezone,
      durationMinutes,
      data,
    };
  }
}
