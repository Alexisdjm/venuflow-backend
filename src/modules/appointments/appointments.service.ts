import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import type { AuthUser } from '../../common/auth.types';
import { PrismaService } from '../../database/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';
@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    @Optional() private mail?: MailService,
    @Optional() private config?: ConfigService,
  ) {}
  private isConcurrentBookingConflict(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2004'
    )
      return true;
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('Appointment_no_confirmed_overlap') ||
      message.includes('23P01') ||
      message.includes('exclusion constraint')
    );
  }

  private isCustomerCategoryConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private categoryConflict() {
    return new ConflictException(
      'Esta clienta ya tiene una cita de esta categoría en la fecha seleccionada',
    );
  }

  private async customerFor(
    spaId: string,
    input: {
      name: string;
      nationalId: string;
      phone: string;
      email?: string;
    },
  ) {
    const existing = await this.prisma.customer.findUnique({
      where: { spaId_nationalId: { spaId, nationalId: input.nationalId } },
    });
    if (existing) return { customer: existing, created: false };
    try {
      const customer = await this.prisma.customer.create({
        data: { spaId, ...input },
      });
      return { customer, created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.customer.findUnique({
          where: { spaId_nationalId: { spaId, nationalId: input.nationalId } },
        });
        if (raced) return { customer: raced, created: false };
      }
      throw error;
    }
  }

  private validateSlot(
    spa: {
      timezone: string;
      openingMinute: number;
      closingMinute: number;
      walkInGraceMinutes: number;
    },
    startAt: string | Date,
    durationMinutes: number,
  ) {
    const start =
      typeof startAt === 'string'
        ? DateTime.fromISO(startAt, { setZone: true })
        : DateTime.fromJSDate(startAt);
    if (!start.isValid) throw new BadRequestException('El horario no es válido');
    const local = start.setZone(spa.timezone);
    if (
      local.minute % 30 !== 0 ||
      local.second !== 0 ||
      local.millisecond !== 0
    )
      throw new BadRequestException('El horario debe caer en un intervalo de 30 minutos');
    const now = DateTime.utc();
    const isWalkIn = start.toUTC() < now;
    if (isWalkIn) {
      const minutesLate = now.diff(start.toUTC(), 'minutes').minutes;
      if (minutesLate > spa.walkInGraceMinutes)
        throw new BadRequestException('No se puede agendar una cita en el pasado');
    }
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
        'La cita queda fuera del horario del spa',
      );
    return { start, end, local, startMinute, endMinute, isWalkIn };
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
    if (!p) throw new NotFoundException('No se encontró el perfil profesional');
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
      if (!start.isValid) throw new BadRequestException('La fecha no es válida');
      range = {
        startAt: {
          gte: start.toUTC().toJSDate(),
          lt: start.plus({ days: 1 }).toUTC().toJSDate(),
        },
      };
    }
    const appointments = await this.prisma.appointment.findMany({
      where: { spaId: u.spaId!, professionalId, status, ...range },
      include: {
        professional: { select: { displayName: true } },
        service: {
          select: {
            name: true,
            durationType: true,
            durationMinutes: true,
            priceType: true,
            price: true,
          },
        },
        bookingRequest: { select: { id: true } },
      },
      orderBy: { startAt: 'asc' },
    });
    return appointments.map(({ bookingRequest, ...appointment }) => ({
      ...appointment,
      remote: Boolean(bookingRequest),
    }));
  }
  async create(u: AuthUser, d: CreateAppointmentDto) {
    const spaId = u.spaId!,
      service = await this.prisma.spaService.findUnique({
        where: { id_spaId: { id: d.serviceId, spaId } },
      });
    if (!service?.isActive) throw new NotFoundException('No se encontró el servicio');
    const spa = await this.prisma.spa.findUniqueOrThrow({
      where: { id: spaId },
      select: {
        timezone: true,
        openingMinute: true,
        closingMinute: true,
        walkInGraceMinutes: true,
      },
    });
    const durationMinutes =
      service.durationType === 'VARIABLE'
        ? d.durationMinutes
        : service.durationMinutes;
    if (durationMinutes === undefined || durationMinutes === null)
      throw new BadRequestException(
        'Indica la duración del servicio',
      );
    let servicePrice = service.price;
    if (service.priceType === 'VARIABLE') {
      if (d.additionalPrice === undefined)
        throw new BadRequestException(
          'Indica el adicional del servicio',
        );
      const additionalPrice = new Prisma.Decimal(d.additionalPrice);
      if (additionalPrice.isNegative())
        throw new BadRequestException(
          'El adicional no puede ser negativo',
        );
      servicePrice = service.price.plus(additionalPrice);
    } else if (d.additionalPrice !== undefined) {
      throw new BadRequestException(
        'Este servicio no admite un adicional',
      );
    }
    const slot = this.validateSlot(spa, d.startAt, durationMinutes);
    const appointmentDate = new Date(`${slot.local.toISODate()}T00:00:00.000Z`);
    let customer = d.customerId
      ? await this.prisma.customer.findUnique({
          where: { id_spaId: { id: d.customerId, spaId } },
        })
      : null;
    if (d.customerId && !customer)
      throw new NotFoundException('No se encontró el cliente');
    if (
      customer &&
      (await this.prisma.appointment.findFirst({
        where: {
          spaId,
          customerId: customer.id,
          appointmentDate,
          serviceCategoryId: service.categoryId,
          status: { not: 'CANCELLED' },
        },
        select: { id: true },
      }))
    )
      throw this.categoryConflict();
    let candidates: string[];
    if (u.role === 'PROFESSIONAL') {
      const own = await this.own(u);
      if (d.professionalId && d.professionalId !== own.id)
        throw new BadRequestException('Solo puedes agendar citas en tu propia agenda');
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
    let customerWasCreated = false;
    for (const professionalId of candidates) {
      const assignment = await this.availableAssignment(
        spaId,
        professionalId,
        d.serviceId,
        slot,
      );
      if (!assignment) continue;
      try {
        if (!customer) {
          const resolved = await this.customerFor(spaId, {
            name: d.customerName!,
            nationalId: d.customerNationalId!,
            phone: d.customerPhone!,
            email: d.customerEmail,
          });
          customer = resolved.customer;
          customerWasCreated = resolved.created;
          if (
            !resolved.created &&
            (await this.prisma.appointment.findFirst({
              where: {
                spaId,
                customerId: customer.id,
                appointmentDate,
                serviceCategoryId: service.categoryId,
                status: { not: 'CANCELLED' },
              },
              select: { id: true },
            }))
          )
            throw this.categoryConflict();
        }
        const appointment = await this.prisma.appointment.create({
          data: {
            spaId,
            professionalId,
            serviceId: d.serviceId,
            customerId: customer.id,
            customerName: customer.name,
            customerPhone: customer.phone,
            customerNationalId: customer.nationalId,
            customerEmail: customer.email,
            notes: d.notes,
            startAt: slot.start.toUTC().toJSDate(),
            endAt: slot.end.toUTC().toJSDate(),
            appointmentDate,
            serviceCategoryId: service.categoryId,
            servicePrice,
            commissionRate: assignment.professional.commissionRate,
            isWalkIn: slot.isWalkIn,
            createdById: u.sub,
          },
          include: {
            professional: { select: { displayName: true } },
            service: {
              select: {
                name: true,
                durationType: true,
                durationMinutes: true,
                priceType: true,
                price: true,
              },
            },
          },
        });
        await this.audit.record({
          spaId,
          actorUserId: u.sub,
          action: 'APPOINTMENT_CREATED',
          entityType: 'Appointment',
          entityId: appointment.id,
          metadata: { isWalkIn: slot.isWalkIn },
        });
        return {
          ...appointment,
          customerStatus: customerWasCreated ? 'new' : 'recurring',
        };
      } catch (error) {
        if (this.isCustomerCategoryConflict(error))
          throw this.categoryConflict();
        if (this.isConcurrentBookingConflict(error)) continue;
        throw error;
      }
    }
    throw new ConflictException('No hay una profesional disponible en ese horario');
  }
  async update(u: AuthUser, id: string, d: UpdateAppointmentDto) {
    const spaId = u.spaId!,
      ownProfessional =
        u.role === 'PROFESSIONAL' ? (await this.own(u)).id : undefined;
    const current = await this.prisma.appointment.findFirst({
      where: { id, spaId, professionalId: ownProfessional },
      include: {
        service: true,
        bookingRequest: { select: { id: true, email: true, token: true } },
      },
    });
    if (!current) throw new NotFoundException('No se encontró la cita');
    if (current.status !== 'CONFIRMED')
      throw new ConflictException(
        'No se puede modificar una cita completada o cancelada',
      );
    if (!d.status && !d.startAt && !d.professionalId)
      throw new BadRequestException('Indica qué quieres cambiar');
    if (d.status === 'COMPLETED') {
      if (d.startAt || d.professionalId)
        throw new BadRequestException(
          'No se puede reprogramar una cita que ya se completó',
        );
      if (current.endAt.getTime() > Date.now())
        throw new ConflictException(
          'La cita todavía no termina, así que no se puede marcar como completada',
        );
    }
    if (
      ownProfessional &&
      d.professionalId &&
      d.professionalId !== ownProfessional
    )
      throw new BadRequestException(
        'No puedes pasar la cita a otra profesional',
      );
    const targetProfessionalId = d.professionalId ?? current.professionalId;
    let startAt: Date | undefined,
      endAt: Date | undefined,
      appointmentDate: Date | undefined;
    let commissionRate: Prisma.Decimal | undefined;
    if (d.startAt || d.professionalId) {
      if (current.status !== 'CONFIRMED')
        throw new ConflictException(
          'Solo se pueden reprogramar citas confirmadas',
        );
      const appointmentDuration = Math.round(
        (current.endAt.getTime() - current.startAt.getTime()) / 60000,
      );
      const spa = await this.prisma.spa.findUniqueOrThrow({
        where: { id: spaId },
        select: {
          timezone: true,
          openingMinute: true,
          closingMinute: true,
          walkInGraceMinutes: true,
        },
      });
      const slot = this.validateSlot(
        spa,
        d.startAt ?? current.startAt,
        appointmentDuration,
      );
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
          'La profesional no realiza este servicio',
        );
      commissionRate = assignment.professional.commissionRate;
      const schedule = await this.prisma.professionalSchedule.findFirst({
        where: {
          spaId,
          professionalId: targetProfessionalId,
          dayOfWeek: slot.local.weekday % 7,
          isActive: true,
          startMinute: { lte: slot.startMinute },
          endMinute: { gte: slot.endMinute },
        },
      });
      if (!schedule)
        throw new ConflictException(
          'El nuevo horario está fuera de la jornada',
        );
      const conflict = await this.prisma.appointment.findFirst({
        where: {
          id: { not: id },
          spaId,
          professionalId: targetProfessionalId,
          status: { not: 'CANCELLED' },
          startAt: { lt: slot.end.toUTC().toJSDate() },
          endAt: { gt: slot.start.toUTC().toJSDate() },
        },
      });
      if (conflict)
        throw new ConflictException(
          'La profesional no está disponible en el nuevo horario',
        );
      startAt = slot.start.toUTC().toJSDate();
      endAt = slot.end.toUTC().toJSDate();
      appointmentDate = new Date(`${slot.local.toISODate()}T00:00:00.000Z`);
      const duplicateCategory = await this.prisma.appointment.findFirst({
        where: {
          id: { not: id },
          spaId,
          customerId: current.customerId,
          appointmentDate,
          serviceCategoryId: current.serviceCategoryId,
          status: { not: 'CANCELLED' },
        },
        select: { id: true },
      });
      if (duplicateCategory) throw this.categoryConflict();
    }
    let value;
    try {
      value = await this.prisma.appointment.update({
        where: { id_spaId: { id, spaId } },
        data: {
          status: d.status,
          startAt,
          endAt,
          appointmentDate,
          professionalId: d.professionalId,
          commissionRate,
        },
      });
    } catch (error) {
      if (this.isCustomerCategoryConflict(error)) throw this.categoryConflict();
      if (this.isConcurrentBookingConflict(error))
        throw new ConflictException(
          'La profesional no está disponible en el nuevo horario',
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
    await this.notifyRemoteChange(current, value, d);
    return value;
  }

  private async notifyRemoteChange(
    current: {
      id: string;
      spaId: string;
      customerName: string;
      startAt: Date;
      professionalId: string;
      service: { name: string };
      bookingRequest: { id: string; email: string; token: string } | null;
    },
    updated: { professionalId: string; startAt: Date },
    change: UpdateAppointmentDto,
  ) {
    const request = current.bookingRequest;
    if (!this.mail || !request?.email) return;
    if (change.status === 'COMPLETED') return;
    const scheduleChanged = Boolean(change.startAt || change.professionalId);
    if (change.status !== 'CANCELLED' && !scheduleChanged) return;
    const spa = await this.prisma.spa.findUnique({
      where: { id: current.spaId },
      select: { name: true, timezone: true },
    });
    const professional = await this.prisma.professional.findFirst({
      where: { id: updated.professionalId, spaId: current.spaId },
      select: { displayName: true },
    });
    const timezone = spa?.timezone ?? 'UTC';
    const message = {
      to: request.email,
      customerName: current.customerName,
      spaName: spa?.name ?? 'VenueFlow',
      serviceName: current.service.name,
      professionalName: professional?.displayName ?? 'Profesional',
      when: this.formatWhen(updated.startAt, timezone),
      previousWhen: this.formatWhen(current.startAt, timezone),
      verificationUrl: this.verificationUrl(request.token),
      reference: `Código ${bookingCode(current.id)}.`,
    };
    if (change.status === 'CANCELLED') {
      await this.prisma.bookingRequest.update({
        where: { id: request.id },
        data: { status: 'CANCELLED' },
      });
      await this.mail.sendBookingCancellation(message);
      return;
    }
    await this.mail.sendBookingUpdate(message);
  }

  private verificationUrl(token: string) {
    const base = this.config?.get<string>('PUBLIC_BOOKING_BASE_URL') ?? 'http://localhost:3002';
    return `${base.replace(/\/$/, '')}/booking/verify?token=${encodeURIComponent(token)}`;
  }

  private formatWhen(value: Date, timezone: string) {
    return DateTime.fromJSDate(value, { zone: 'utc' })
      .setZone(timezone)
      .setLocale('es')
      .toLocaleString(DateTime.DATETIME_FULL);
  }
}

function bookingCode(appointmentId: string) {
  return `VF-${appointmentId.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}
