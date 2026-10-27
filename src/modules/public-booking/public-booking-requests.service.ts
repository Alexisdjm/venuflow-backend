import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { CreatePublicBookingDto } from './dto/create-public-booking.dto';
import { PublicBookingService, type PublicSequenceSegment } from './public-booking.service';

const REQUEST_MINUTES = 15;
const RESEND_SECONDS = 60;

const requestInclude = {
  spa: true,
  service: true,
  customer: true,
  appointment: true,
} satisfies Prisma.BookingRequestInclude;

type BookingRecord = Prisma.BookingRequestGetPayload<{ include: typeof requestInclude }>;

@Injectable()
export class PublicBookingRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly catalog: PublicBookingService,
  ) {}

  async create(dto: CreatePublicBookingDto) {
    const spa = await this.prisma.spa.findUnique({ where: { slug: dto.spaSlug } });
    if (!spa || spa.status !== 'ACTIVE') throw new NotFoundException('Spa no encontrado');
    if (dto.serviceIds.length > 1) return this.createSequence(spa, dto);
    const service = await this.prisma.spaService.findUnique({
      where: { id_spaId: { id: dto.serviceIds[0], spaId: spa.id } },
    });
    if (!service?.isActive) throw new NotFoundException('Servicio no encontrado');
    if (
      service.durationType !== 'FIXED' ||
      service.durationMinutes == null ||
      service.priceType !== 'FIXED'
    ) {
      throw new BadRequestException(
        'Este servicio se confirma en el spa porque su duración o precio no es fijo.',
      );
    }
    const slot = this.slot(spa, dto.start, service.durationMinutes);
    const professionalId = dto.professionalId && dto.professionalId !== 'any' ? dto.professionalId : undefined;
    const available = await this.firstAvailable(spa.id, service.id, slot, professionalId);
    if (!available) throw new ConflictException('El horario ya no está disponible.');
    const email = dto.customer.email.trim().toLowerCase();
    const nationalId = dto.customer.nationalId;
    const customer = await this.customerFor(spa.id, {
      name: dto.customer.name.trim(),
      nationalId,
      phone: dto.customer.phone.trim(),
      email,
    });
    const appointmentDate = new Date(`${slot.local.toISODate()}T00:00:00.000Z`);
    if (await this.categoryTaken(spa.id, customer.id, appointmentDate, service.categoryId)) {
      throw new ConflictException('Ya existe una reserva de esta categoría para ese día.');
    }
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const request = await this.prisma.bookingRequest.create({
      data: {
        spaId: spa.id,
        customerId: customer.id,
        serviceId: service.id,
        professionalId: professionalId ?? null,
        token,
        email,
        submittedName: dto.customer.name.trim(),
        submittedPhone: dto.customer.phone.trim(),
        nationalId,
        startAt: slot.start.toUTC().toJSDate(),
        endAt: slot.end.toUTC().toJSDate(),
        expiresAt: new Date(now.getTime() + REQUEST_MINUTES * 60_000),
        resendAvailableAt: new Date(now.getTime() + RESEND_SECONDS * 1000),
      },
      include: requestInclude,
    });
    try {
      await this.mail.sendBookingVerification(await this.mailFor(request, token));
    } catch (error) {
      await this.prisma.bookingRequest.delete({ where: { id: request.id } });
      throw error;
    }
    return {
      requestId: request.id,
      expiresAt: request.expiresAt.toISOString(),
    };
  }

  async resend(id: string) {
    const request = await this.prisma.bookingRequest.findUnique({
      where: { id },
      include: requestInclude,
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    await this.assertPending(request);
    if (request.resendAvailableAt.getTime() > Date.now()) {
      throw new HttpException(
        'Podrás reenviar el correo en unos segundos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const nextRetryAt = new Date(Date.now() + RESEND_SECONDS * 1000);
    await this.prisma.bookingRequest.update({
      where: { id },
      data: { resendAvailableAt: nextRetryAt },
    });
    await this.mail.sendBookingVerification(await this.mailFor(request, request.token));
    return { nextRetryAt: nextRetryAt.toISOString() };
  }

  async details(token: string) {
    const request = await this.byToken(token);
    return this.present(request);
  }

  async confirm(token: string, idempotencyKey?: string) {
    if (!idempotencyKey) throw new BadRequestException('Falta la clave de confirmación.');
    const existing = await this.byToken(token);
    if (existing.status === 'CONFIRMED' && existing.receiptToken && existing.appointment) {
      return this.receipt(existing, existing.receiptToken);
    }
    await this.assertPending(existing);
    const segments = readSegments(existing.segments);
    if (segments.length > 1) return this.confirmSequence(existing, segments, idempotencyKey);
    const slot = this.slot(existing.spa, existing.startAt.toISOString(), existing.service.durationMinutes ?? 0);
    const chosen = await this.firstAvailable(
      existing.spaId,
      existing.serviceId,
      slot,
      existing.professionalId ?? undefined,
    );
    if (!chosen) throw new ConflictException('El horario ya no está disponible.');
    const appointmentDate = new Date(`${slot.local.toISODate()}T00:00:00.000Z`);
    if (await this.categoryTaken(existing.spaId, existing.customerId, appointmentDate, existing.service.categoryId)) {
      throw new ConflictException('Ya existe una reserva de esta categoría para ese día.');
    }
    const receiptToken = randomBytes(32).toString('base64url');
    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        const current = await tx.bookingRequest.findUnique({ where: { id: existing.id } });
        if (!current || current.status !== 'PENDING') {
          throw new ConflictException('Esta solicitud ya no se puede confirmar.');
        }
        const appointment = await tx.appointment.create({
          data: {
            spaId: existing.spaId,
            professionalId: chosen.id,
            serviceId: existing.serviceId,
            customerId: existing.customerId,
            customerName: existing.customer.name,
            customerPhone: existing.customer.phone,
            customerNationalId: existing.customer.nationalId,
            customerEmail: existing.email,
            startAt: slot.start.toUTC().toJSDate(),
            endAt: slot.end.toUTC().toJSDate(),
            appointmentDate,
            serviceCategoryId: existing.service.categoryId,
            servicePrice: existing.service.price,
            commissionRate: chosen.commissionRate,
            isWalkIn: false,
            createdById: null,
          },
        });
        return tx.bookingRequest.update({
          where: { id: existing.id },
          data: {
            status: 'CONFIRMED',
            professionalId: chosen.id,
            appointmentId: appointment.id,
            receiptToken,
            idempotencyKey,
          },
          include: requestInclude,
        });
      });
      await this.audit.record({
        spaId: saved.spaId,
        action: 'APPOINTMENT_CREATED',
        entityType: 'Appointment',
        entityId: saved.appointmentId,
        metadata: { source: 'public-booking' },
      });
      return this.receipt(saved, receiptToken);
    } catch (error) {
      if (this.isOverlap(error)) throw new ConflictException('El horario ya no está disponible.');
      throw error;
    }
  }

  async cancel(token: string) {
    const request = await this.byToken(token);
    if (request.status === 'CANCELLED') return { status: 'CANCELLED' as const };
    await this.assertPending(request);
    await this.prisma.bookingRequest.update({
      where: { id: request.id },
      data: { status: 'CANCELLED' },
    });
    await this.mail.sendBookingCancellation({
      ...(await this.mailFor(request, request.token)),
      reference: 'La cita no llegó a confirmarse.',
    });
    await this.audit.record({
      spaId: request.spaId,
      action: 'BOOKING_REQUEST_CANCELLED',
      entityType: 'BookingRequest',
      entityId: request.id,
    });
    return { status: 'CANCELLED' as const };
  }

  async confirmation(receiptToken: string) {
    const request = await this.byReceipt(receiptToken);
    if (request.status === 'CANCELLED' || (readSegments(request.segments).length < 2 && request.appointment?.status === 'CANCELLED')) {
      throw new NotFoundException('La reserva fue cancelada.');
    }
    return this.receipt(request, receiptToken);
  }

  async cancelConfirmed(receiptToken: string) {
    const request = await this.byReceipt(receiptToken);
    if (request.status === 'CANCELLED' || request.appointment?.status === 'CANCELLED') {
      return { status: 'CANCELLED' as const };
    }
    if (!request.appointment) throw new NotFoundException('Comprobante no disponible.');
    await this.prisma.$transaction([
      this.prisma.appointment.updateMany({
        where: {
          OR: [{ id: request.appointment.id }, { visitRequestId: request.id }],
        },
        data: { status: 'CANCELLED' },
      }),
      this.prisma.bookingRequest.update({
        where: { id: request.id },
        data: { status: 'CANCELLED' },
      }),
    ]);
    const code = bookingCode(request.appointment.id);
    await this.mail.sendBookingCancellation({
      ...(await this.mailFor(request, request.token)),
      reference: `Código ${code}.`,
    });
    await this.audit.record({
      spaId: request.spaId,
      action: 'APPOINTMENT_CANCELLED',
      entityType: 'Appointment',
      entityId: request.appointment.id,
      metadata: { source: 'public-booking' },
    });
    return { status: 'CANCELLED' as const };
  }

  private async createSequence(
    spa: { id: string; slug: string; timezone: string },
    dto: CreatePublicBookingDto,
  ) {
    if (!dto.items || dto.items.length !== dto.serviceIds.length || dto.items.some((item, index) => item.serviceId !== dto.serviceIds[index])) {
      throw new BadRequestException('Indica el orden y la profesional de cada servicio.');
    }
    const plans = await this.catalog.planSequence(spa.slug, {
      date: dto.start.slice(0, 10),
      start: dto.start,
      sameProfessional: Boolean(dto.sameProfessional),
      items: dto.items,
    });
    const plan = plans[0];
    if (!plan) throw new ConflictException('El horario ya no está disponible.');
    const email = dto.customer.email.trim().toLowerCase();
    const nationalId = dto.customer.nationalId;
    const customer = await this.customerFor(spa.id, {
      name: dto.customer.name.trim(),
      nationalId,
      phone: dto.customer.phone.trim(),
      email,
    });
    for (const segment of plan.segments) {
      const local = DateTime.fromISO(segment.start, { setZone: true }).setZone(spa.timezone);
      const appointmentDate = new Date(`${local.toISODate()}T00:00:00.000Z`);
      if (await this.categoryTaken(spa.id, customer.id, appointmentDate, segment.categoryId)) {
        throw new ConflictException('Ya existe una reserva de una de estas categorías para ese día.');
      }
    }
    const sameProfessional = new Set(plan.segments.map((segment) => segment.professionalId)).size === 1;
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const request = await this.prisma.bookingRequest.create({
      data: {
        spaId: spa.id,
        customerId: customer.id,
        serviceId: plan.segments[0].serviceId,
        professionalId: sameProfessional ? plan.segments[0].professionalId : null,
        token,
        email,
        submittedName: dto.customer.name.trim(),
        submittedPhone: dto.customer.phone.trim(),
        nationalId,
        startAt: new Date(plan.start),
        endAt: new Date(plan.end),
        expiresAt: new Date(now.getTime() + REQUEST_MINUTES * 60_000),
        resendAvailableAt: new Date(now.getTime() + RESEND_SECONDS * 1000),
        segments: plan.segments,
      },
      include: requestInclude,
    });
    try {
      await this.mail.sendBookingVerification(await this.mailFor(request, token));
    } catch (error) {
      await this.prisma.bookingRequest.delete({ where: { id: request.id } });
      throw error;
    }
    return { requestId: request.id, expiresAt: request.expiresAt.toISOString() };
  }

  private async confirmSequence(
    existing: BookingRecord,
    segments: PublicSequenceSegment[],
    idempotencyKey: string,
  ) {
    for (const segment of segments) {
      const slot = this.slot(existing.spa, segment.start, segment.durationMinutes);
      const chosen = await this.firstAvailable(existing.spaId, segment.serviceId, slot, segment.professionalId);
      if (!chosen || chosen.id !== segment.professionalId) {
        throw new ConflictException('El horario ya no está disponible.');
      }
      const appointmentDate = new Date(`${slot.local.toISODate()}T00:00:00.000Z`);
      if (await this.categoryTaken(existing.spaId, existing.customerId, appointmentDate, segment.categoryId)) {
        throw new ConflictException('Ya existe una reserva de una de estas categorías para ese día.');
      }
    }
    const receiptToken = randomBytes(32).toString('base64url');
    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        const current = await tx.bookingRequest.findUnique({ where: { id: existing.id } });
        if (!current || current.status !== 'PENDING') {
          throw new ConflictException('Esta solicitud ya no se puede confirmar.');
        }
        let firstId = '';
        for (const segment of segments) {
          const local = DateTime.fromISO(segment.start, { setZone: true }).setZone(existing.spa.timezone);
          const appointment = await tx.appointment.create({
            data: {
              spaId: existing.spaId,
              professionalId: segment.professionalId,
              serviceId: segment.serviceId,
              customerId: existing.customerId,
              customerName: existing.customer.name,
              customerPhone: existing.customer.phone,
              customerNationalId: existing.customer.nationalId,
              customerEmail: existing.email,
              startAt: new Date(segment.start),
              endAt: new Date(segment.end),
              appointmentDate: new Date(`${local.toISODate()}T00:00:00.000Z`),
              serviceCategoryId: segment.categoryId,
              servicePrice: new Prisma.Decimal(segment.price),
              commissionRate: new Prisma.Decimal(segment.commissionRate),
              isWalkIn: false,
              createdById: null,
              visitRequestId: existing.id,
              visitGroupId: existing.id,
            },
          });
          if (!firstId) firstId = appointment.id;
        }
        const sharedProfessional = new Set(segments.map((segment) => segment.professionalId)).size === 1
          ? segments[0].professionalId
          : null;
        return tx.bookingRequest.update({
          where: { id: existing.id },
          data: {
            status: 'CONFIRMED',
            professionalId: sharedProfessional,
            appointmentId: firstId,
            receiptToken,
            idempotencyKey,
          },
          include: requestInclude,
        });
      });
      await this.audit.record({
        spaId: saved.spaId,
        action: 'APPOINTMENT_CREATED',
        entityType: 'Appointment',
        entityId: saved.appointmentId,
        metadata: { source: 'public-booking', segments: segments.length },
      });
      return this.receipt(saved, receiptToken);
    } catch (error) {
      if (this.isOverlap(error)) throw new ConflictException('El horario ya no está disponible.');
      throw error;
    }
  }

  private async customerFor(
    spaId: string,
    input: { name: string; nationalId: string; phone: string; email: string },
  ) {
    const existing = await this.prisma.customer.findUnique({
      where: { spaId_nationalId: { spaId, nationalId: input.nationalId } },
    });
    if (existing) return existing;
    try {
      return await this.prisma.customer.create({ data: { spaId, ...input } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.customer.findUnique({
          where: { spaId_nationalId: { spaId, nationalId: input.nationalId } },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  private async byToken(token: string) {
    const request = await this.prisma.bookingRequest.findUnique({
      where: { token },
      include: requestInclude,
    });
    if (!request) throw new NotFoundException('Enlace inválido');
    return request;
  }

  private async byReceipt(receiptToken: string) {
    const request = await this.prisma.bookingRequest.findUnique({
      where: { receiptToken },
      include: requestInclude,
    });
    if (!request?.appointment) throw new NotFoundException('Comprobante no disponible.');
    return request;
  }

  private async assertPending(request: BookingRecord) {
    if (request.status === 'EXPIRED' || (request.status === 'PENDING' && request.expiresAt.getTime() <= Date.now())) {
      if (request.status === 'PENDING') {
        await this.prisma.bookingRequest.update({
          where: { id: request.id },
          data: { status: 'EXPIRED' },
        });
      }
      throw new GoneException('Este enlace expiró. Elige el horario otra vez.');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException('Esta solicitud ya no se puede modificar.');
    }
  }

  private async present(request: BookingRecord) {
    if (request.status === 'PENDING' && request.expiresAt.getTime() <= Date.now()) {
      await this.prisma.bookingRequest.update({
        where: { id: request.id },
        data: { status: 'EXPIRED' },
      });
      request.status = 'EXPIRED';
    }
    if (request.status === 'CANCELLED' || (readSegments(request.segments).length < 2 && request.appointment?.status === 'CANCELLED')) {
      return this.summary(request, 'CANCELLED');
    }
    if (request.status === 'CONFIRMED' && request.receiptToken && request.appointment) {
      return this.receipt(request, request.receiptToken);
    }
    return this.summary(request, request.status === 'EXPIRED' ? 'EXPIRED' : 'PENDING');
  }

  private async summary(request: BookingRecord, status: 'PENDING' | 'EXPIRED' | 'CANCELLED') {
    return {
      requestId: request.id,
      status,
      spaName: request.spa.name,
      serviceNames: segmentNames(request),
      professionalName: segmentProfessionals(request) || await this.professionalLabel(request.spaId, request.professionalId),
      start: request.startAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
    };
  }

  private async receipt(request: BookingRecord, receiptToken: string) {
    const appointment = request.appointment;
    if (!appointment) throw new NotFoundException('Comprobante no disponible.');
    return {
      requestId: request.id,
      status: 'CONFIRMED' as const,
      spaName: request.spa.name,
      serviceNames: segmentNames(request),
      professionalName: segmentProfessionals(request) || await this.professionalLabel(request.spaId, appointment.professionalId),
      start: appointment.startAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      bookingCode: bookingCode(appointment.id),
      total: segmentTotal(request) ?? Number(request.service.price.toString()),
      end: segmentEnd(request) ?? appointment.endAt.toISOString(),
      receiptToken,
    };
  }

  private async mailFor(request: BookingRecord, token: string) {
    return {
      to: request.email,
      customerName: request.customer.name,
      spaName: request.spa.name,
      serviceName: segmentNames(request).join(' · '),
      professionalName: segmentProfessionals(request) || await this.professionalLabel(request.spaId, request.professionalId),
      when: formatWhen(request.startAt, request.spa.timezone),
      expiresAt: formatWhen(request.expiresAt, request.spa.timezone),
      verificationUrl: this.verificationUrl(token),
    };
  }

  private verificationUrl(token: string) {
    const base = this.config.get<string>('PUBLIC_BOOKING_BASE_URL') ?? 'http://localhost:3002';
    return `${base.replace(/\/$/, '')}/booking/verify?token=${encodeURIComponent(token)}`;
  }

  private async professionalLabel(spaId: string, professionalId: string | null) {
    if (!professionalId) return 'Según disponibilidad';
    const professional = await this.prisma.professional.findFirst({
      where: { id: professionalId, spaId },
      select: { displayName: true },
    });
    return professional?.displayName ?? 'Profesional';
  }

  private async firstAvailable(
    spaId: string,
    serviceId: string,
    slot: ReturnType<PublicBookingRequestsService['slot']>,
    professionalId?: string,
  ) {
    const professionals = await this.prisma.professional.findMany({
      where: {
        spaId,
        isActive: true,
        ...(professionalId ? { id: professionalId } : {}),
        services: { some: { serviceId } },
      },
      orderBy: { displayName: 'asc' },
      select: { id: true, commissionRate: true },
    });
    for (const professional of professionals) {
      const schedule = await this.prisma.professionalSchedule.findFirst({
        where: {
          spaId,
          professionalId: professional.id,
          dayOfWeek: slot.local.weekday % 7,
          isActive: true,
          startMinute: { lte: slot.startMinute },
          endMinute: { gte: slot.endMinute },
        },
      });
      if (!schedule) continue;
      const overlap = await this.prisma.appointment.findFirst({
        where: {
          spaId,
          professionalId: professional.id,
          status: 'CONFIRMED',
          startAt: { lt: slot.end.toUTC().toJSDate() },
          endAt: { gt: slot.start.toUTC().toJSDate() },
        },
        select: { id: true },
      });
      if (!overlap) return professional;
    }
    return null;
  }

  private async categoryTaken(spaId: string, customerId: string, appointmentDate: Date, categoryId: string) {
    const existing = await this.prisma.appointment.findFirst({
      where: {
        spaId,
        customerId,
        appointmentDate,
        serviceCategoryId: categoryId,
        status: { not: 'CANCELLED' },
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  private slot(
    spa: { timezone: string; openingMinute: number; closingMinute: number },
    startAt: string,
    durationMinutes: number,
  ) {
    const start = DateTime.fromISO(startAt, { setZone: true });
    if (!start.isValid || durationMinutes <= 0) {
      throw new BadRequestException('Selecciona un horario válido.');
    }
    if (start.toUTC() <= DateTime.utc()) throw new BadRequestException('El horario ya pasó.');
    const local = start.setZone(spa.timezone);
    if (local.minute % 30 !== 0 || local.second !== 0 || local.millisecond !== 0) {
      throw new BadRequestException('Selecciona un horario válido.');
    }
    const end = start.plus({ minutes: durationMinutes });
    const localEnd = end.setZone(spa.timezone);
    const startMinute = local.hour * 60 + local.minute;
    const endMinute = localEnd.hour * 60 + localEnd.minute;
    if (
      !local.hasSame(localEnd, 'day') ||
      startMinute < spa.openingMinute ||
      endMinute > spa.closingMinute
    ) {
      throw new ConflictException('El horario está fuera del horario del spa.');
    }
    return { start, end, local, startMinute, endMinute };
  }

  private isOverlap(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004') ||
      message.includes('Appointment_no_confirmed_overlap') ||
      message.includes('23P01') ||
      message.includes('exclusion constraint')
    );
  }
}

function readSegments(value: Prisma.JsonValue | null): PublicSequenceSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.serviceId !== 'string' || typeof row.professionalId !== 'string' || typeof row.start !== 'string' || typeof row.end !== 'string') return [];
    return [{
      serviceId: row.serviceId,
      serviceName: typeof row.serviceName === 'string' ? row.serviceName : '',
      categoryId: typeof row.categoryId === 'string' ? row.categoryId : '',
      professionalId: row.professionalId,
      professionalName: typeof row.professionalName === 'string' ? row.professionalName : '',
      commissionRate: typeof row.commissionRate === 'string' ? row.commissionRate : '0',
      price: typeof row.price === 'string' ? row.price : '0',
      durationMinutes: typeof row.durationMinutes === 'number' ? row.durationMinutes : 0,
      start: row.start,
      end: row.end,
    }];
  });
}

function segmentNames(request: BookingRecord) {
  const segments = readSegments(request.segments);
  return segments.length ? segments.map((segment) => segment.serviceName) : [request.service.name];
}

function segmentProfessionals(request: BookingRecord) {
  const names = [...new Set(readSegments(request.segments).map((segment) => segment.professionalName).filter(Boolean))];
  return names.join(' · ');
}

function segmentTotal(request: BookingRecord) {
  const segments = readSegments(request.segments);
  if (!segments.length) return undefined;
  return segments.reduce((sum, segment) => sum + Number(segment.price), 0);
}

function segmentEnd(request: BookingRecord) {
  const segments = readSegments(request.segments);
  return segments.at(-1)?.end;
}

function bookingCode(appointmentId: string) {
  return `VF-${appointmentId.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

function formatWhen(value: Date, timezone: string) {
  return DateTime.fromJSDate(value, { zone: 'utc' })
    .setZone(timezone)
    .setLocale('es')
    .toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);
}
