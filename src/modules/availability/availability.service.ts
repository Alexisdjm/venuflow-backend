import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  alreadyStarted,
  pastBeyondGrace,
  professionalBusy,
  SchedulingService,
} from '../scheduling/scheduling.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: SchedulingService,
  ) {}
  async get(spaId: string, q: AvailabilityQueryDto, publicBooking = false) {
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
      throw new BadRequestException('Indica la duración del servicio');
    if (durationMinutes > spa.closingMinute - spa.openingMinute)
      throw new BadRequestException('La duración supera el horario del spa');
    const localDate = DateTime.fromISO(q.date, { zone: spa.timezone }).startOf(
      'day',
    );
    if (!localDate.isValid)
      throw new NotFoundException('La fecha no es válida');
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
    const appointments = await this.scheduling.busyBetween({
      spaId,
      from: localDate.toUTC().toJSDate(),
      until: dayEnd.toUTC().toJSDate(),
    });
    const data = assignments.flatMap(({ professional }) =>
      professional.schedules.flatMap((schedule) => {
        const slots = [];
        for (
          let minute = publicBooking
            ? Math.ceil(schedule.startMinute / 30) * 30
            : schedule.startMinute;
          minute + durationMinutes <= schedule.endMinute;
          minute += q.intervalMinutes
        ) {
          const start = localDate.plus({ minutes: minute });
          const end = start.plus({ minutes: durationMinutes });
          if (publicBooking) {
            try {
              this.scheduling.publicSlot(spa, start.toISO()!, durationMinutes);
            } catch (error) {
              if (
                error instanceof BadRequestException ||
                error instanceof ConflictException
              )
                continue;
              throw error;
            }
          }
          const isGracePeriod = alreadyStarted(start);
          if (pastBeyondGrace(start, spa.walkInGraceMinutes)) continue;
          const occupied = professionalBusy(
            appointments,
            professional.id,
            start.toJSDate(),
            end.toJSDate(),
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
