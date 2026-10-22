import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import type { AuthUser } from '../../common/auth.types';
import { PrismaService } from '../../database/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';
@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}
  private isConcurrentBookingConflict(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2004'].includes(error.code)
    )
      return true;
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('Appointment_no_confirmed_overlap') ||
      message.includes('23P01') ||
      message.includes('exclusion constraint')
    );
  }

  private validateSlot(
    spa: { timezone: string; openingMinute: number; closingMinute: number },
    startAt: string | Date,
    durationMinutes: number,
  ) {
    const start =
      typeof startAt === 'string'
        ? DateTime.fromISO(startAt, { setZone: true })
        : DateTime.fromJSDate(startAt);
    if (!start.isValid) throw new BadRequestException('Invalid startAt');
    const local = start.setZone(spa.timezone);
    if (
      local.minute % 30 !== 0 ||
      local.second !== 0 ||
      local.millisecond !== 0
    )
      throw new BadRequestException('startAt must use a 30-minute interval');
    if (start.toUTC() < DateTime.utc())
      throw new BadRequestException('Appointments cannot start in the past');
    const end = start.plus({ minutes: durationMinutes });
    const localEnd = end.setZone(spa.timezone);
    const startMinute = local.hour * 60 + local.minute;
    const endMinute = localEnd.hour * 60 + localEnd.minute;
    if (
      !local.hasSame(localEnd, 'day') ||
      startMinute < spa.openingMinute ||
      endMinute > spa.closingMinute
    )
      throw new ConflictException(
        'The appointment is outside the spa operating hours',
      );
    return { start, end, local, startMinute, endMinute };
  }

  private async availableAssignment(
    spaId: string,
    professionalId: string,
    serviceId: string,
    slot: ReturnType<AppointmentsService['validateSlot']>,
    excludedAppointmentId?: string,
  ) {
    const assignment = await this.prisma.professionalService.findFirst({
      where: {
        spaId,
        professionalId,
        serviceId,
        professional: { isActive: true },
      },
      include: { professional: { select: { commissionRate: true } } },
    });
    if (!assignment) return null;
    const schedule = await this.prisma.professionalSchedule.findFirst({
      where: {
        spaId,
        professionalId,
        dayOfWeek: slot.local.weekday % 7,
        isActive: true,
        startMinute: { lte: slot.startMinute },
        endMinute: { gte: slot.endMinute },
      },
    });
    if (!schedule) return null;
    const conflict = await this.prisma.appointment.findFirst({
      where: {
        id: excludedAppointmentId ? { not: excludedAppointmentId } : undefined,
        spaId,
        professionalId,
        status: 'CONFIRMED',
        startAt: { lt: slot.end.toUTC().toJSDate() },
        endAt: { gt: slot.start.toUTC().toJSDate() },
      },
    });
    return conflict ? null : assignment;
  }
  private async own(u: AuthUser) {
    const p = await this.prisma.professional.findFirst({
      where: { spaId: u.spaId!, userId: u.sub, isActive: true },
    });
    if (!p) throw new NotFoundException('Professional profile not found');
    return p;
  }
  async list(
    u: AuthUser,
    date?: string,
    status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED',
  ) {
    const professionalId =
      u.role === 'PROFESSIONAL' ? (await this.own(u)).id : undefined;
    let range = {};
    if (date) {
      const spa = await this.prisma.spa.findUniqueOrThrow({
        where: { id: u.spaId! },
      });
      const start = DateTime.fromISO(date, { zone: spa.timezone }).startOf(
        'day',
      );
      if (!start.isValid) throw new BadRequestException('Invalid date');
      range = {
        startAt: {
          gte: start.toUTC().toJSDate(),
          lt: start.plus({ days: 1 }).toUTC().toJSDate(),
        },
      };
    }
    return this.prisma.appointment.findMany({
      where: { spaId: u.spaId!, professionalId, status, ...range },
      include: {
        professional: { select: { displayName: true } },
        service: { select: { name: true, durationMinutes: true, price: true } },
      },
      orderBy: { startAt: 'asc' },
    });
  }
  async create(u: AuthUser, d: CreateAppointmentDto) {
    const spaId = u.spaId!,
      service = await this.prisma.spaService.findUnique({
        where: { id_spaId: { id: d.serviceId, spaId } },
      });
    if (!service?.isActive) throw new NotFoundException('Service not found');
    const spa = await this.prisma.spa.findUniqueOrThrow({
      where: { id: spaId },
      select: { timezone: true, openingMinute: true, closingMinute: true },
    });
    const slot = this.validateSlot(spa, d.startAt, service.durationMinutes);
    let candidates: string[];
    if (u.role === 'PROFESSIONAL') {
      const own = await this.own(u);
      if (d.professionalId && d.professionalId !== own.id)
        throw new BadRequestException('Professionals can only book themselves');
      candidates = [own.id];
    } else if (d.professionalId) candidates = [d.professionalId];
    else
      candidates = (
        await this.prisma.professionalService.findMany({
          where: {
            spaId,
            serviceId: d.serviceId,
            professional: { isActive: true },
          },
          select: { professionalId: true },
        })
      ).map((x) => x.professionalId);
    for (const professionalId of candidates) {
      const assignment = await this.availableAssignment(
        spaId,
        professionalId,
        d.serviceId,
        slot,
      );
      if (!assignment) continue;
      try {
        const appointment = await this.prisma.appointment.create({
          data: {
            spaId,
            professionalId,
            serviceId: d.serviceId,
            customerName: d.customerName,
            customerPhone: d.customerPhone,
            customerEmail: d.customerEmail,
            notes: d.notes,
            startAt: slot.start.toUTC().toJSDate(),
            endAt: slot.end.toUTC().toJSDate(),
            servicePrice: service.price,
            commissionRate: assignment.professional.commissionRate,
            createdById: u.sub,
          },
          include: {
            professional: { select: { displayName: true } },
            service: {
              select: { name: true, durationMinutes: true, price: true },
            },
          },
        });
        await this.audit.record({
          spaId,
          actorUserId: u.sub,
          action: 'APPOINTMENT_CREATED',
          entityType: 'Appointment',
          entityId: appointment.id,
        });
        return appointment;
      } catch (error) {
        if (this.isConcurrentBookingConflict(error)) continue;
        throw error;
      }
    }
    throw new ConflictException('No professional is available for this time');
  }
  async update(u: AuthUser, id: string, d: UpdateAppointmentDto) {
    const spaId = u.spaId!,
      ownProfessional =
        u.role === 'PROFESSIONAL' ? (await this.own(u)).id : undefined;
    const current = await this.prisma.appointment.findFirst({
      where: { id, spaId, professionalId: ownProfessional },
      include: { service: true },
    });
    if (!current) throw new NotFoundException('Appointment not found');
    if (current.status !== 'CONFIRMED')
      throw new ConflictException(
        'Completed or cancelled appointments cannot be changed',
      );
    if (!d.status && !d.startAt && !d.professionalId)
      throw new BadRequestException('Provide a change');
    if (d.status === 'COMPLETED') {
      if (d.startAt || d.professionalId)
        throw new BadRequestException(
          'A completed appointment cannot be rescheduled or transferred',
        );
      if (current.endAt.getTime() > Date.now())
        throw new ConflictException(
          'An appointment cannot be completed before it ends',
        );
    }
    if (
      ownProfessional &&
      d.professionalId &&
      d.professionalId !== ownProfessional
    )
      throw new BadRequestException(
        'Professionals cannot transfer appointments',
      );
    const targetProfessionalId = d.professionalId ?? current.professionalId;
    let startAt: Date | undefined, endAt: Date | undefined;
    let commissionRate: Prisma.Decimal | undefined;
    if (d.startAt || d.professionalId) {
      if (current.status !== 'CONFIRMED')
        throw new ConflictException(
          'Only confirmed appointments can be rescheduled',
        );
      const start = DateTime.fromJSDate(
        d.startAt ? new Date(d.startAt) : current.startAt,
      );
      if (!start.isValid || start.minute % 30 !== 0)
        throw new BadRequestException('startAt must use a 30-minute interval');
      if (start.toUTC() < DateTime.utc())
        throw new BadRequestException(
          'Appointments cannot be rescheduled to the past',
        );
      const end = start.plus({ minutes: current.service.durationMinutes });
      const assignment = await this.prisma.professionalService.findFirst({
        where: {
          spaId,
          professionalId: targetProfessionalId,
          serviceId: current.serviceId,
          professional: { isActive: true },
        },
        include: { professional: { select: { commissionRate: true } } },
      });
      if (!assignment)
        throw new ConflictException(
          'The professional does not perform this service',
        );
      commissionRate = assignment.professional.commissionRate;
      const spa = await this.prisma.spa.findUniqueOrThrow({
          where: { id: spaId },
        }),
        local = start.setZone(spa.timezone),
        startMinute = local.hour * 60 + local.minute,
        endMinute = startMinute + current.service.durationMinutes;
      const schedule = await this.prisma.professionalSchedule.findFirst({
        where: {
          spaId,
          professionalId: targetProfessionalId,
          dayOfWeek: local.weekday % 7,
          isActive: true,
          startMinute: { lte: startMinute },
          endMinute: { gte: endMinute },
        },
      });
      if (!schedule)
        throw new ConflictException(
          'The new time is outside the professional schedule',
        );
      const conflict = await this.prisma.appointment.findFirst({
        where: {
          id: { not: id },
          spaId,
          professionalId: targetProfessionalId,
          status: { not: 'CANCELLED' },
          startAt: { lt: end.toUTC().toJSDate() },
          endAt: { gt: start.toUTC().toJSDate() },
        },
      });
      if (conflict)
        throw new ConflictException(
          'The professional is not available at the new time',
        );
      startAt = start.toUTC().toJSDate();
      endAt = end.toUTC().toJSDate();
    }
    let value;
    try {
      value = await this.prisma.appointment.update({
        where: { id_spaId: { id, spaId } },
        data: {
          status: d.status,
          startAt,
          endAt,
          professionalId: d.professionalId,
          commissionRate,
        },
      });
    } catch (error) {
      if (this.isConcurrentBookingConflict(error))
        throw new ConflictException(
          'The professional is not available at the new time',
        );
      throw error;
    }
    await this.audit.record({
      spaId,
      actorUserId: u.sub,
      action:
        d.startAt || d.professionalId
          ? 'APPOINTMENT_RESCHEDULED'
          : 'APPOINTMENT_UPDATED',
      entityType: 'Appointment',
      entityId: id,
      metadata: {
        status: d.status ?? current.status,
        startAt: d.startAt ?? null,
        professionalId: d.professionalId ?? null,
      },
    });
    return value;
  }
}
