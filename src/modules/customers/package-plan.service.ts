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

  async preview(spaId: string, customerId: string, dto: PackagePlanDto) {
    const planned = await this.plan(spaId, customerId, dto);
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
    customerId: string,
    dto: PackagePlanDto,
  ) {
    const planned = await this.plan(spaId, customerId, dto);
    if (!planned.sessions.length)
      throw new ConflictException('No hay horarios para ese plan.');
    const price = planned.service.price;
    const paid = this.optionalMoney(dto.paidAmount, price);
    const created = await this.prisma.$transaction(async (tx) => {
      const pack = await tx.customerPackage.create({
        data: {
          spaId,
          customerId,
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
      for (const session of planned.sessions) {
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
              customerId,
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
            customerId,
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
      if (paid)
        await tx.packagePayment.create({
          data: { spaId, customerPackageId: pack.id, amount: paid },
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
        customerId,
        serviceId: planned.service.id,
        scheduled: planned.sessions.length,
      },
    });
    return {
      id: created.id,
      scheduled: planned.sessions.length,
      missing: planned.missing,
    };
  }

  private async plan(spaId: string, customerId: string, dto: PackagePlanDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id_spaId: { id: customerId, spaId } },
    });
    if (!customer) throw new NotFoundException('No se encontró el cliente');
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
      this.prisma.appointment.findMany({
        where: {
          spaId,
          customerId,
          serviceCategoryId: service.categoryId,
          status: { not: 'CANCELLED' },
          appointmentDate: { gte: from, lt: until },
        },
        select: { appointmentDate: true },
      }),
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

  private optionalMoney(value: string | undefined, limit: Prisma.Decimal) {
    if (value === undefined || value.trim() === '') return null;
    const amount = new Prisma.Decimal(value);
    if (amount.isNegative())
      throw new BadRequestException('El abono no puede ser negativo.');
    if (amount.isZero()) return null;
    if (amount.greaterThan(limit))
      throw new BadRequestException('El abono supera el precio del paquete.');
    return amount;
  }
}
