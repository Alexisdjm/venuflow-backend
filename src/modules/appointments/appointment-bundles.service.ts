import { randomUUID } from 'crypto';
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
import {
  AppointmentBundleItemDto,
  BundleAvailabilityDto,
  CreateAppointmentBundleDto,
} from './dto/appointment-bundle.dto';

type ResolvedItem = {
  service: NonNullable<
    Awaited<ReturnType<AppointmentBundlesService['service']>>
  >;
  durationMinutes: number;
  price: Prisma.Decimal;
  requestedProfessionalId?: string;
};

@Injectable()
export class AppointmentBundlesService {
  constructor(private readonly prisma: PrismaService) {}

  private service(spaId: string, id: string) {
    return this.prisma.spaService.findUnique({
      where: { id_spaId: { id, spaId } },
      include: { category: true },
    });
  }

  private async resolveItems(spaId: string, items: AppointmentBundleItemDto[]) {
    const resolved: ResolvedItem[] = [];
    const categories = new Set<string>();
    for (const item of items) {
      const service = await this.service(spaId, item.serviceId);
      if (!service?.isActive) throw new NotFoundException('No se encontró el servicio');
      if (categories.has(service.categoryId))
        throw new ConflictException(
          'Una cita combinada no puede repetir la misma categoría',
        );
      categories.add(service.categoryId);
      const durationMinutes =
        service.durationType === 'VARIABLE'
          ? item.durationMinutes
          : service.durationMinutes;
      if (!durationMinutes)
        throw new BadRequestException(
          'Indica la duración del servicio',
        );
      let price = service.price;
      if (service.priceType === 'VARIABLE') {
        if (item.additionalPrice === undefined)
          throw new BadRequestException(
            'Indica el adicional del servicio',
          );
        const additional = new Prisma.Decimal(item.additionalPrice);
        if (additional.isNegative())
          throw new BadRequestException(
            'El adicional no puede ser negativo',
          );
        price = price.plus(additional);
      } else if (item.additionalPrice !== undefined) {
        throw new BadRequestException(
          'Este servicio no admite un adicional',
        );
      }
      resolved.push({
        service,
        durationMinutes,
        price,
        requestedProfessionalId: item.professionalId,
      });
    }
    return resolved;
  }

  private async ownProfessional(u: AuthUser) {
    const professional = await this.prisma.professional.findFirst({
      where: { spaId: u.spaId!, userId: u.sub, isActive: true },
    });
    if (!professional)
      throw new NotFoundException('No se encontró el perfil profesional');
    return professional.id;
  }

  private async plans(
    u: AuthUser,
    date: string,
    items: ResolvedItem[],
    intervalMinutes: number,
    onlyStart?: DateTime,
  ) {
    const spa = await this.prisma.spa.findUniqueOrThrow({
      where: { id: u.spaId! },
    });
    const localDate = DateTime.fromISO(date, { zone: spa.timezone }).startOf(
      'day',
    );
    if (!localDate.isValid) throw new BadRequestException('La fecha no es válida');
    const ownId =
      u.role === 'PROFESSIONAL' ? await this.ownProfessional(u) : undefined;
    const serviceIds = items.map((item) => item.service.id);
    const assignments = await this.prisma.professionalService.findMany({
      where: {
        spaId: u.spaId!,
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
    });
    const appointments = await this.prisma.appointment.findMany({
      where: {
        spaId: u.spaId!,
        status: { not: 'CANCELLED' },
        startAt: { lt: localDate.plus({ days: 1 }).toUTC().toJSDate() },
        endAt: { gt: localDate.toUTC().toJSDate() },
      },
      select: { professionalId: true, startAt: true, endAt: true },
    });
    const now = DateTime.now().setZone(spa.timezone);
    const total = items.reduce((sum, item) => sum + item.durationMinutes, 0);
    const starts = onlyStart
      ? [onlyStart.setZone(spa.timezone)]
      : Array.from(
          {
            length:
              Math.floor(
                (spa.closingMinute - spa.openingMinute - total) /
                  intervalMinutes,
              ) + 1,
          },
          (_, index) =>
            localDate.plus({
              minutes: spa.openingMinute + index * intervalMinutes,
            }),
        );
    return starts.flatMap((start) => {
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
      )
        return [];
      if (
        start < now &&
        now.diff(start, 'minutes').minutes > spa.walkInGraceMinutes
      )
        return [];
      let cursor = start;
      const segments = [];
      for (const item of items) {
        const end = cursor.plus({ minutes: item.durationMinutes });
        const segmentStartMinute = cursor.hour * 60 + cursor.minute;
        const endMinute = end.hour * 60 + end.minute;
        const requestedId = ownId ?? item.requestedProfessionalId;
        const assignment = assignments.find(
          (candidate) =>
            candidate.serviceId === item.service.id &&
            (!requestedId || candidate.professionalId === requestedId) &&
            candidate.professional.schedules.some(
              (schedule) =>
                schedule.startMinute <= segmentStartMinute &&
                schedule.endMinute >= endMinute,
            ) &&
            !appointments.some(
              (appointment) =>
                appointment.professionalId === candidate.professionalId &&
                appointment.startAt < end.toUTC().toJSDate() &&
                appointment.endAt > cursor.toUTC().toJSDate(),
            ),
        );
        if (!assignment) return [];
        segments.push({
          serviceId: item.service.id,
          serviceName: item.service.name,
          categoryId: item.service.categoryId,
          categoryName: item.service.category.name,
          professionalId: assignment.professionalId,
          professionalName: assignment.professional.displayName,
          commissionRate: assignment.professional.commissionRate.toString(),
          start: cursor.toUTC().toISO(),
          end: end.toUTC().toISO(),
          durationMinutes: item.durationMinutes,
          price: item.price.toString(),
        });
        cursor = end;
      }
      return [
        { start: start.toUTC().toISO(), end: cursor.toUTC().toISO(), segments },
      ];
    });
  }

  async availability(u: AuthUser, dto: BundleAvailabilityDto) {
    const items = await this.resolveItems(u.spaId!, dto.items);
    return {
      date: dto.date,
      data: await this.plans(u, dto.date, items, dto.intervalMinutes),
    };
  }

  async create(u: AuthUser, dto: CreateAppointmentBundleDto) {
    const items = await this.resolveItems(u.spaId!, dto.items);
    const requestedStart = DateTime.fromISO(dto.startAt, { setZone: true });
    if (!requestedStart.isValid)
      throw new BadRequestException('El horario no es válido');
    const spa = await this.prisma.spa.findUniqueOrThrow({
      where: { id: u.spaId! },
      select: { timezone: true },
    });
    const plans = await this.plans(
      u,
      requestedStart.setZone(spa.timezone).toISODate()!,
      items,
      30,
      requestedStart,
    );
    const plan = plans[0];
    if (!plan)
      throw new ConflictException(
        'La secuencia de servicios ya no está disponible',
      );
    try {
      return await this.prisma.$transaction(async (tx) => {
        let customer = dto.customerId
          ? await tx.customer.findUnique({
              where: { id_spaId: { id: dto.customerId, spaId: u.spaId! } },
            })
          : null;
        if (dto.customerId && !customer)
          throw new NotFoundException('No se encontró el cliente');
        let customerWasCreated = false;
        if (!customer && dto.customerNationalId) {
          customer = await tx.customer.findUnique({
            where: {
              spaId_nationalId: {
                spaId: u.spaId!,
                nationalId: dto.customerNationalId,
              },
            },
          });
        }
        if (!customer) {
          customer = await tx.customer.create({
            data: {
              spaId: u.spaId!,
              name: dto.customerName!,
              nationalId: dto.customerNationalId!,
              phone: dto.customerPhone!,
              email: dto.customerEmail,
            },
          });
          customerWasCreated = true;
        }
        const visitGroupId = plan.segments.length > 1 ? randomUUID() : null;
        const created = [];
        for (let index = 0; index < plan.segments.length; index += 1) {
          const segment = plan.segments[index];
          const item = items[index];
          const localDate = DateTime.fromISO(segment.start!, {
            setZone: true,
          }).setZone(spa.timezone);
          created.push(
            await tx.appointment.create({
              data: {
                spaId: u.spaId!,
                professionalId: segment.professionalId,
                serviceId: segment.serviceId,
                customerId: customer.id,
                customerName: customer.name,
                customerPhone: customer.phone,
                customerNationalId: customer.nationalId,
                customerEmail: customer.email,
                notes: dto.notes,
                startAt: new Date(segment.start!),
                endAt: new Date(segment.end!),
                appointmentDate: new Date(
                  `${localDate.toISODate()}T00:00:00.000Z`,
                ),
                serviceCategoryId: item.service.categoryId,
                servicePrice: item.price,
                commissionRate: segment.commissionRate,
                isWalkIn: requestedStart < DateTime.utc(),
                createdById: u.sub,
                visitGroupId,
              },
            }),
          );
        }
        return {
          appointments: created,
          customerStatus: customerWasCreated ? 'new' : 'recurring',
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Esta clienta ya tiene una cita de una de estas categorías en la fecha seleccionada',
        );
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('23P01') || message.includes('exclusion constraint'))
        throw new ConflictException(
          'La secuencia de servicios ya no está disponible',
        );
      throw error;
    }
  }
}
