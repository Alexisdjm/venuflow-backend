import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { effectiveCommissionRate } from '../services/extra-commission';
import {
  alreadyStarted,
  SchedulingService,
} from '../scheduling/scheduling.service';
import { PackagePlanDto } from './dto/customer-package.dto';
import { placePackageSessions } from './package-plan';

@Injectable()
export class PackagePlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: SchedulingService,
    private readonly audit: AuditService,
  ) {}

  async preview(spaId: string, customerId: string | undefined, dto: PackagePlanDto) {
    const customer = await this.resolveCustomer(spaId, customerId, dto, false);
    const planned = await this.plan(spaId, customer, dto);
    return {
      sessionCount: planned.service.sessionCount,
      sessionsPerWeek: planned.weekdays.length,
      missing: planned.missing,
      sessions: planned.sessions.map((session) => ({
        start: session.start.toUTC().toISO(),
        end: session.end.toUTC().toISO(),
        localStart: session.start.toISO(),
        professionalId: planned.professionalId,
        professionalName: planned.professionalName,
      })),
    };
  }

  async confirm(
    spaId: string,
    actorUserId: string,
    customerId: string | undefined,
    dto: PackagePlanDto,
  ) {
    const customer = await this.resolveCustomer(spaId, customerId, dto, true);
    const planned = await this.plan(spaId, customer, dto);
    const sessions = await this.adjustedSessions(spaId, planned, dto.sessionStarts);
    if (!sessions.length)
      throw new ConflictException('No hay horarios para ese plan.');
    const price = planned.service.price;
    const created = await this.prisma.$transaction(async (tx) => {
      const pack = await tx.customerPackage.create({
        data: {
          spaId,
          customerId: customer.id,
          serviceId: planned.service.id,
          name: planned.service.name,
          sessionCount: planned.service.sessionCount,
          price,
          sessionValue: price.div(planned.service.sessionCount).toDecimalPlaces(2),
          sessionsPerWeek: planned.weekdays.length,
          preferredWeekdays: planned.weekdays,
          preferredProfessionalId: planned.professionalId,
          inactivityDays: planned.service.validityDays,
          maxReschedules: dto.maxReschedules ?? 2,
          expiresAt: null,
        },
      });
      await tx.$queryRaw`
        SELECT id FROM "CustomerPackage"
        WHERE id = CAST(${pack.id} AS uuid) AND "spaId" = CAST(${spaId} AS uuid)
        FOR UPDATE
      `;
      for (const session of sessions) {
        const appointmentDate = new Date(`${session.start.toISODate()}T00:00:00.000Z`);
        const conflict = await this.scheduling.conflictingAppointment(
          {
            spaId,
            professionalId: planned.professionalId,
            start: session.start.toJSDate(),
            end: session.end.toJSDate(),
          },
          tx,
        );
        if (conflict)
          throw new ConflictException(
            'Un horario del plan ya no está libre. Vuelve a calcularlo.',
          );
        if (
          await this.scheduling.categoryTaken(
            {
              spaId,
              customerId: customer.id,
              appointmentDate,
              categoryId: planned.service.categoryId,
            },
            tx,
          )
        )
          throw new ConflictException(
            'El cliente ya tiene una cita ese día. Vuelve a calcular el plan.',
          );
        await tx.appointment.create({
          data: {
            spaId,
            professionalId: planned.professionalId,
            serviceId: planned.service.id,
            customerId: customer.id,
            customerPackageId: pack.id,
            customerName: planned.customer.name,
            customerPhone: planned.customer.phone,
            customerNationalId: planned.customer.nationalId,
            customerEmail: planned.customer.email,
            paymentMethod: dto.paymentMethod,
            startAt: session.start.toUTC().toJSDate(),
            endAt: session.end.toUTC().toJSDate(),
            appointmentDate,
            serviceCategoryId: planned.service.categoryId,
            servicePrice: price.div(planned.service.sessionCount).toDecimalPlaces(2),
            commissionRate: planned.commissionRate,
            isWalkIn: alreadyStarted(session.start),
            createdById: actorUserId,
          },
        });
      }
      await tx.packagePayment.create({
        data: { spaId, customerPackageId: pack.id, amount: price },
      });
      return tx.customerPackage.findUniqueOrThrow({
        where: { id: pack.id },
        include: {
          payments: { orderBy: { createdAt: 'asc' } },
          appointments: { select: { status: true, startAt: true } },
        },
      });
    });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'CUSTOMER_PACKAGE_CREATED',
      entityType: 'CustomerPackage',
      entityId: created.id,
      metadata: {
        customerId: customer.id,
        serviceId: planned.service.id,
        scheduled: sessions.length,
      },
    });
    return {
      id: created.id,
      scheduled: sessions.length,
      missing: planned.missing,
    };
  }

  private async adjustedSessions(
    spaId: string,
    planned: {
      professionalId: string;
      sessions: { start: DateTime; end: DateTime }[];
    },
    starts: string[] | undefined,
  ) {
    if (!starts?.length) return planned.sessions;
    if (starts.length !== planned.sessions.length)
      throw new BadRequestException('El plan editado no coincide con las sesiones.');
    const durationMinutes = Math.round(
      planned.sessions[0].end.diff(planned.sessions[0].start).as('minutes'),
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
    const allowed = new Set(
      planned.sessions.map((session) => session.start.toISODate()).filter((date): date is string => Boolean(date)),
    );
    const claimed = new Set<string>();
    const adjusted: { start: DateTime; end: DateTime }[] = [];
    for (const startAt of starts) {
      const slot = this.scheduling.dashboardSlot(spa, startAt, durationMinutes);
      const date = slot.local.toISODate();
      if (!date || !allowed.has(date) || claimed.has(date))
        throw new BadRequestException(
          'Solo se puede cambiar la hora dentro del mismo día de cada sesión.',
        );
      const shift = await this.scheduling.shiftCovering(
        spaId,
        planned.professionalId,
        slot.local.weekday % 7,
        slot.startMinute,
        slot.endMinute,
      );
      if (!shift)
        throw new ConflictException('El nuevo horario está fuera de la jornada.');
      claimed.add(date);
      adjusted.push({
        start: slot.local,
        end: slot.local.plus({ minutes: durationMinutes }),
      });
    }
    return adjusted;
  }

  private async resolveCustomer(
    spaId: string,
    customerId: string | undefined,
    dto: PackagePlanDto,
    create: boolean,
  ) {
    const id = customerId ?? dto.customerId;
    if (id) {
      const customer = await this.prisma.customer.findUnique({
        where: { id_spaId: { id, spaId } },
      });
      if (!customer) throw new NotFoundException('No se encontró el cliente');
      return customer;
    }
    if (!dto.customerName || !dto.customerNationalId || !dto.customerPhone)
      throw new BadRequestException('Registra el cliente del paquete.');
    const existing = await this.prisma.customer.findUnique({
      where: { spaId_nationalId: { spaId, nationalId: dto.customerNationalId } },
    });
    if (existing) return existing;
    if (!create) {
      return {
        id: '',
        spaId,
        name: dto.customerName,
        phone: dto.customerPhone,
        nationalId: dto.customerNationalId,
        email: dto.customerEmail ?? null,
      };
    }
    try {
      return await this.prisma.customer.create({
        data: {
          spaId,
          name: dto.customerName,
          nationalId: dto.customerNationalId,
          phone: dto.customerPhone,
          email: dto.customerEmail,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.customer.findUnique({
          where: { spaId_nationalId: { spaId, nationalId: dto.customerNationalId } },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  private async plan(
    spaId: string,
    customer: { id: string; name: string; phone: string; nationalId: string | null; email: string | null },
    dto: PackagePlanDto,
  ) {
    const service = await this.prisma.spaService.findUnique({
      where: { id_spaId: { id: dto.serviceId, spaId } },
    });
    if (!service?.isActive || service.offering !== 'PACKAGE')
      throw new BadRequestException('Elige un servicio activo de varias sesiones.');
    const weekdays = this.weekdays(dto.preferredWeekdays, dto.sessionsPerWeek);
    const durationMinutes =
      service.durationType === 'VARIABLE' ? dto.durationMinutes : service.durationMinutes;
    if (!durationMinutes)
      throw new BadRequestException('Indica la duración de cada sesión.');
    const spa = await this.prisma.spa.findUniqueOrThrow({
      where: { id: spaId },
      select: {
        timezone: true,
        openingMinute: true,
        closingMinute: true,
        walkInGraceMinutes: true,
      },
    });
    const slot = this.scheduling.dashboardSlot(spa, dto.startAt, durationMinutes);
    const weekday = slot.local.weekday % 7;
    if (!weekdays.includes(weekday))
      throw new BadRequestException(
        'La primera sesión tiene que caer en uno de los días elegidos.',
      );
    const assignment = await this.scheduling.findAssignment(
      spaId,
      dto.professionalId,
      service.id,
    );
    if (!assignment)
      throw new ConflictException('La profesional no realiza este servicio.');
    const professional = await this.prisma.professional.findFirst({
      where: { id: dto.professionalId, spaId, isActive: true },
      select: { displayName: true, schedules: { where: { isActive: true } } },
    });
    if (!professional) throw new NotFoundException('No se encontró la profesional');
    const openDays = [...new Set(professional.schedules.map((shift) => shift.dayOfWeek))];
    const closed = weekdays.filter((day) => !openDays.includes(day));
    if (closed.length)
      throw new BadRequestException(
        'Esos días no están en la agenda de la profesional.',
      );
    const expiresAt = null;
    const horizonEnd = slot.local.plus({ days: Math.max(service.sessionCount * 21, 60) });
    const from = slot.local.startOf('day').toUTC().toJSDate();
    const until = horizonEnd.toUTC().toJSDate();
    const [busy, holds, taken] = await Promise.all([
      this.scheduling.busyBetween({
        spaId,
        from,
        until,
        professionalIds: [dto.professionalId],
      }),
      this.scheduling.paymentHolds(spaId, from, until),
      customer.id
        ? this.prisma.appointment.findMany({
            where: {
              spaId,
              customerId: customer.id,
              serviceCategoryId: service.categoryId,
              status: { not: 'CANCELLED' },
              appointmentDate: { gte: from, lt: until },
            },
            select: { appointmentDate: true },
          })
        : Promise.resolve([]),
    ]);
    const placed = placePackageSessions({
      firstStart: slot.local,
      durationMinutes,
      sessionCount: service.sessionCount,
      sessionsPerWeek: weekdays.length,
      preferredWeekdays: weekdays,
      professionalId: dto.professionalId,
      shifts: professional.schedules,
      busy: [...busy, ...holds],
      takenDates: new Set(
        taken.map((row) => row.appointmentDate.toISOString().slice(0, 10)),
      ),
      expiresAt,
      graceMinutes: spa.walkInGraceMinutes,
    });
    if (!placed.firstPlaced)
      throw new ConflictException(
        'Ese horario no está disponible para la primera sesión.',
      );
    return {
      customer,
      service,
      professionalId: dto.professionalId,
      professionalName: professional.displayName,
      weekdays,
      expiresAt,
      missing: placed.missing,
      sessions: placed.sessions,
      commissionRate: effectiveCommissionRate(
        assignment.professional.commissionRate,
        service,
      ),
    };
  }

  private weekdays(days: number[], perWeek: number) {
    const unique = [...new Set(days)];
    if (unique.length !== perWeek || unique.some((day) => day < 0 || day > 6))
      throw new BadRequestException(
        'Elige un día distinto por cada sesión de la semana.',
      );
    return unique;
  }

}
