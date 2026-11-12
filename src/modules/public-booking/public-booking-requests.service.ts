import { afterCommit } from '../../common/after-commit';
import { publicSpaUrl, readBookingUrlConfig } from '../../common/public-booking-url';
import { databaseConflict } from '../../common/database-conflict';
import { randomUUID } from 'node:crypto';
import {
  acceptsPublicBookings,
  publicServiceEligibility,
} from './public-booking-policy';
import { bookingTokenSecret } from './booking-secret';
import {
  bookingToken,
  bookingTokenHash,
  matchesBookingToken,
} from './booking-tokens';
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
import {
  PublicBookingService,
  type PublicSequenceSegment,
} from './public-booking.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { effectiveCommissionRate } from '../services/extra-commission';

const REQUEST_MINUTES = 15;
const RESEND_SECONDS = 60;
const CREATE_WINDOW_MS = 10 * 60_000;
const CREATE_LIMIT = 5;

const requestInclude = {
  spa: true,
  service: true,
  customer: true,
  appointment: {
    include: {
      service: { select: { name: true } },
      professional: { select: { displayName: true } },
    },
  },
  visitAppointments: {
    include: {
      service: { select: { name: true } },
      professional: { select: { displayName: true } },
    },
  },
} satisfies Prisma.BookingRequestInclude;

type BookingRecord = Prisma.BookingRequestGetPayload<{
  include: typeof requestInclude;
}>;

@Injectable()
export class PublicBookingRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly catalog: PublicBookingService,
    private readonly scheduling: SchedulingService,
  ) {}

  async create(dto: CreatePublicBookingDto) {
    const spa = await this.prisma.spa.findUnique({
      where: { slug: dto.spaSlug },
    });
    if (!acceptsPublicBookings(spa))
      throw new NotFoundException('Spa no encontrado');
    if (dto.serviceIds.length > 1) return this.createSequence(spa, dto);
    const service = await this.prisma.spaService.findUnique({
      where: { id_spaId: { id: dto.serviceIds[0], spaId: spa.id } },
    });
    if (!service?.isActive)
      throw new NotFoundException('Servicio no encontrado');
    if (
      !publicServiceEligibility(service).onlineBookable ||
      service.durationMinutes == null
    ) {
      throw new BadRequestException(
        'Este servicio se confirma en el spa porque su duración o precio no es fijo.',
      );
    }
    const slot = this.slot(spa, dto.start, service.durationMinutes);
    const professionalId =
      dto.professionalId && dto.professionalId !== 'any'
        ? dto.professionalId
        : undefined;
    const available = await this.firstAvailable(
      spa.id,
      service.id,
      slot,
      professionalId,
    );
    if (!available)
      throw new ConflictException('El horario ya no está disponible.');
    const email = dto.customer.email.trim().toLowerCase();
    await this.assertCreateQuota(spa.id, email);
    const nationalId = dto.customer.nationalId;
    const id = randomUUID();
    const token = this.tokenFor(id, 'verification');
    const now = new Date();
    const request = await this.prisma.bookingRequest.create({
      data: {
        spaId: spa.id,
        serviceId: service.id,
        professionalId: professionalId ?? null,
        id,
        token: bookingTokenHash(token, 'verification'),
        tokenVersion: 1,
        email,
        submittedName: dto.customer.name.trim(),
        submittedPhone: dto.customer.phone.trim(),
        nationalId,
        startAt: slot.start.toUTC().toJSDate(),
        endAt: slot.end.toUTC().toJSDate(),
        segments: [
          {
            serviceId: service.id,
            serviceName: service.name,
            categoryId: service.categoryId,
            professionalId: professionalId ?? '',
            professionalName: '',
            commissionRate: effectiveCommissionRate(
              available.commissionRate,
              service,
            ).toString(),
            price: service.price.toString(),
            durationMinutes: service.durationMinutes,
            currency: spa.currency,
            timezone: spa.timezone,
            start: slot.start.toUTC().toISO()!,
            end: slot.end.toUTC().toISO()!,
          },
        ],
        expiresAt: new Date(now.getTime() + REQUEST_MINUTES * 60_000),
        resendAvailableAt: new Date(now.getTime() + RESEND_SECONDS * 1000),
      },
      include: requestInclude,
    });
    try {
      await this.mail.sendBookingVerification(
        await this.mailFor(request, token),
      );
    } catch (error) {
      await this.prisma.bookingRequest.delete({ where: { id: request.id } });
      throw error;
    }
    return {
      requestId: `${request.id}.${this.tokenFor(request.id, 'resend')}`,
      expiresAt: request.expiresAt.toISOString(),
    };
  }

  async resend(capability: string) {
    const [id, credential, extra] = capability.split('.');
    if (
      !/^[0-9a-f-]{36}$/i.test(id ?? '') ||
      extra ||
      !credential ||
      !matchesBookingToken(credential, this.tokenFor(id, 'resend'))
    ) {
      throw new NotFoundException('Solicitud no encontrada');
    }
    const request = await this.prisma.bookingRequest.findUnique({
      where: { id },
      include: requestInclude,
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    this.assertRelations(request);
    await this.assertPending(request);
    const nextRetryAt = new Date(Date.now() + RESEND_SECONDS * 1000);
    const claimed = await this.prisma.bookingRequest.updateMany({
      where: {
        id: request.id,
        spaId: request.spaId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        resendAvailableAt: { lte: new Date() },
      },
      data: { resendAvailableAt: nextRetryAt },
    });
    if (claimed.count !== 1) {
      throw new HttpException(
        'Podrás reenviar el correo en unos segundos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      await this.mail.sendBookingVerification(
        await this.mailFor(request, this.verificationToken(request)),
      );
    } catch (error) {
      await this.prisma.bookingRequest.updateMany({
        where: {
          id: request.id,
          spaId: request.spaId,
          status: 'PENDING',
          resendAvailableAt: nextRetryAt,
        },
        data: { resendAvailableAt: new Date() },
      });
      throw error;
    }
    return { nextRetryAt: nextRetryAt.toISOString() };
  }

  async details(token: string) {
    const request = await this.byToken(token);
    return this.present(request);
  }

  async confirm(token: string, idempotencyKey?: string) {
    if (
      !idempotencyKey ||
      idempotencyKey.length > 128 ||
      !/^[\x21-\x7E]+$/.test(idempotencyKey)
    ) {
      throw new BadRequestException('Falta una clave de confirmacion valida.');
    }
    const identified = await this.byToken(token, true);
    let result: { saved: BookingRecord; created: boolean };
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "BookingRequest" WHERE "id" = ${identified.id}::uuid AND "spaId" = ${identified.spaId}::uuid FOR UPDATE`;
          const current = await tx.bookingRequest.findUnique({
            where: { id: identified.id, spaId: identified.spaId },
            include: requestInclude,
          });
          if (!current) throw new NotFoundException('Enlace invalido');
          this.assertRelations(current);
          if (
            current.status === 'CONFIRMED' &&
            current.appointment &&
            current.receiptToken
          ) {
            if (current.idempotencyKey !== idempotencyKey)
              throw new ConflictException(
                'Esta solicitud ya fue confirmada con otra clave.',
              );
            return { saved: current, created: false };
          }
          await this.assertPending(current, tx);
          // Share locks serialize administrative changes to booking conditions
          // against this confirmation, without holding any external HTTP call.
          await tx.$queryRaw`SELECT "id" FROM "Spa" WHERE "id" = ${current.spaId}::uuid FOR SHARE`;
          const fresh = await tx.bookingRequest.findUniqueOrThrow({
            where: { id: current.id },
            include: requestInclude,
          });
          await this.assertConfirmable(fresh, tx);
          const segments = readSegments(fresh.segments);
          for (const id of [
            ...new Set(segments.map((s) => s.serviceId)),
          ].sort()) {
            await tx.$queryRaw`SELECT "id" FROM "SpaService" WHERE "id" = ${id}::uuid AND "spaId" = ${fresh.spaId}::uuid FOR SHARE`;
          }
          await this.assertConfirmable(fresh, tx);
          const customer = await this.verifiedCustomer(fresh, tx);
          const serviceExtras = new Map(
            (
              await tx.spaService.findMany({
                where: {
                  spaId: fresh.spaId,
                  id: { in: [...new Set(segments.map((segment) => segment.serviceId))] },
                },
                select: {
                  id: true,
                  extraCommission: true,
                  extraCommissionRate: true,
                },
              })
            ).map((service) => [service.id, service]),
          );
          let firstId = '';
          const professionalIds: string[] = [];
          for (const [index, segment] of segments.entries()) {
            const slot = this.slot(
              fresh.spa,
              segment.start,
              segment.durationMinutes,
              index > 0,
            );
            const requested =
              segments.length === 1
                ? (fresh.professionalId ?? undefined)
                : segment.professionalId;
            const chosen = await this.firstAvailable(
              fresh.spaId,
              segment.serviceId,
              slot,
              requested,
              tx,
            );
            if (!chosen)
              throw new ConflictException('El horario ya no esta disponible.');
            const appointmentDate = new Date(
              `${slot.local.toISODate()}T00:00:00.000Z`,
            );
            if (
              await this.scheduling.categoryTaken(
                {
                  spaId: fresh.spaId,
                  customerId: customer.id,
                  appointmentDate,
                  categoryId: segment.categoryId,
                },
                tx,
              )
            ) {
              throw new ConflictException(
                'Ya existe una reserva de esta categoria para ese dia.',
              );
            }
            const appointment = await tx.appointment.create({
              data: {
                spaId: fresh.spaId,
                professionalId: chosen.id,
                serviceId: segment.serviceId,
                customerId: customer.id,
                customerName: fresh.submittedName,
                customerPhone: fresh.submittedPhone,
                customerNationalId: fresh.nationalId,
                customerEmail: fresh.email,
                startAt: slot.start.toUTC().toJSDate(),
                endAt: slot.end.toUTC().toJSDate(),
                appointmentDate,
                serviceCategoryId: segment.categoryId,
                servicePrice: new Prisma.Decimal(segment.price),
                commissionRate: effectiveCommissionRate(
                  chosen.commissionRate,
                  serviceExtras.get(segment.serviceId),
                ),
                isWalkIn: false,
                createdById: null,
                ...(segments.length > 1
                  ? { visitRequestId: fresh.id, visitGroupId: fresh.id }
                  : {}),
              },
            });
            if (!firstId) firstId = appointment.id;
            professionalIds.push(chosen.id);
          }
          const receiptToken = this.receiptToken(fresh);
          const saved = await tx.bookingRequest.update({
            where: { id: fresh.id },
            data: {
              status: 'CONFIRMED',
              customerId: customer.id,
              appointmentId: firstId,
              professionalId:
                new Set(professionalIds).size === 1 ? professionalIds[0] : null,
              receiptToken:
                fresh.tokenVersion === 1
                  ? bookingTokenHash(receiptToken, 'receipt')
                  : receiptToken,
              idempotencyKey,
            },
            include: requestInclude,
          });
          return { saved, created: true };
        },
        { maxWait: 5000, timeout: 15000 },
      );
    } catch (error) {
      throw databaseConflict(error) ?? error;
    }
    if (result.created)
      await afterCommit('public-confirm-audit', () =>
        this.audit.record({
          spaId: result.saved.spaId,
          action: 'APPOINTMENT_CREATED',
          entityType: 'Appointment',
          entityId: result.saved.appointmentId,
          metadata: { source: 'public-booking' },
        }),
      );
    return this.receipt(result.saved, this.receiptToken(result.saved));
  }

  async cancel(token: string) {
    const request = await this.byToken(token);
    if (request.status === 'CANCELLED') return { status: 'CANCELLED' as const };
    await this.assertPending(request);
    const cancelled = await this.prisma.bookingRequest.updateMany({
      where: {
        id: request.id,
        spaId: request.spaId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      data: { status: 'CANCELLED' },
    });
    if (cancelled.count !== 1)
      throw new ConflictException('La solicitud ya no se puede cancelar.');
    await afterCommit('public-cancel-mail', async () => {
      await this.mail.sendBookingCancellation({
        ...(await this.mailFor(request, this.verificationToken(request))),
        reference: 'La cita no llegó a confirmarse.',
      });
    });
    await afterCommit('public-cancel-audit', () =>
      this.audit.record({
        spaId: request.spaId,
        action: 'BOOKING_REQUEST_CANCELLED',
        entityType: 'BookingRequest',
        entityId: request.id,
      }),
    );
    return { status: 'CANCELLED' as const };
  }

  async confirmation(receiptToken: string) {
    const request = await this.byReceipt(receiptToken);
    if (
      request.status === 'CANCELLED' ||
      !this.bookedAppointments(request).some((a) => a.status !== 'CANCELLED')
    ) {
      throw new NotFoundException('La reserva fue cancelada.');
    }
    return this.receipt(request, receiptToken);
  }

  async cancelConfirmed(receiptToken: string) {
    const identified = await this.byReceipt(receiptToken);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "BookingRequest" WHERE "id" = ${identified.id}::uuid AND "spaId" = ${identified.spaId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "spaId" = ${identified.spaId}::uuid AND ("id" = ${identified.appointmentId}::uuid OR "visitRequestId" = ${identified.id}::uuid) ORDER BY "id" FOR UPDATE`;
      const current = await tx.bookingRequest.findUniqueOrThrow({
        where: { id: identified.id },
        include: requestInclude,
      });
      this.assertRelations(current);
      const appointments = this.bookedAppointments(current);
      if (!appointments.some((a) => a.status !== 'CANCELLED'))
        return { request: current, changed: false };
      if (appointments.some((a) => a.status === 'COMPLETED'))
        throw new ConflictException(
          'La visita incluye servicios completados. Contacta al spa para modificarla.',
        );
      await tx.appointment.updateMany({
        where: {
          spaId: current.spaId,
          id: { in: appointments.map((a) => a.id) },
          status: 'CONFIRMED',
        },
        data: { status: 'CANCELLED' },
      });
      await tx.bookingRequest.update({
        where: { id: current.id },
        data: { status: 'CANCELLED' },
      });
      return { request: current, changed: true };
    });
    if (result.changed) {
      await afterCommit('public-cancel-confirmed-mail', async () => {
        await this.mail.sendBookingCancellation({
          ...(await this.mailFor(
            result.request,
            this.verificationToken(result.request),
          )),
          reference: 'Reserva cancelada.',
        });
      });
      await afterCommit('public-cancel-confirmed-audit', () =>
        this.audit.record({
          spaId: result.request.spaId,
          action: 'APPOINTMENT_CANCELLED',
          entityType: 'Appointment',
          entityId: result.request.appointmentId,
          metadata: { source: 'public-booking' },
        }),
      );
    }
    return { status: 'CANCELLED' as const };
  }

  private async createSequence(
    spa: { id: string; slug: string; timezone: string; currency: string },
    dto: CreatePublicBookingDto,
  ) {
    if (
      !dto.items ||
      dto.items.length !== dto.serviceIds.length ||
      dto.items.some((item, index) => item.serviceId !== dto.serviceIds[index])
    ) {
      throw new BadRequestException(
        'Indica el orden y la profesional de cada servicio.',
      );
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
    await this.assertCreateQuota(spa.id, email);
    const nationalId = dto.customer.nationalId;
    const sameProfessional =
      new Set(plan.segments.map((segment) => segment.professionalId)).size ===
      1;
    const id = randomUUID();
    const token = this.tokenFor(id, 'verification');
    const now = new Date();
    const request = await this.prisma.bookingRequest.create({
      data: {
        spaId: spa.id,
        serviceId: plan.segments[0].serviceId,
        professionalId: sameProfessional
          ? plan.segments[0].professionalId
          : null,
        id,
        token: bookingTokenHash(token, 'verification'),
        tokenVersion: 1,
        email,
        submittedName: dto.customer.name.trim(),
        submittedPhone: dto.customer.phone.trim(),
        nationalId,
        startAt: new Date(plan.start),
        endAt: new Date(plan.end),
        expiresAt: new Date(now.getTime() + REQUEST_MINUTES * 60_000),
        resendAvailableAt: new Date(now.getTime() + RESEND_SECONDS * 1000),
        segments: plan.segments.map((segment) => ({
          ...segment,
          currency: spa.currency,
          timezone: spa.timezone,
        })),
      },
      include: requestInclude,
    });
    try {
      await this.mail.sendBookingVerification(
        await this.mailFor(request, token),
      );
    } catch (error) {
      await this.prisma.bookingRequest.delete({ where: { id: request.id } });
      throw error;
    }
    return {
      requestId: `${request.id}.${this.tokenFor(request.id, 'resend')}`,
      expiresAt: request.expiresAt.toISOString(),
    };
  }

  private async assertCreateQuota(spaId: string, email: string) {
    const recent = await this.prisma.bookingRequest.count({
      where: {
        spaId,
        email,
        createdAt: { gt: new Date(Date.now() - CREATE_WINDOW_MS) },
      },
    });
    if (recent >= CREATE_LIMIT)
      throw new HttpException(
        'Demasiadas solicitudes. Intenta más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private tokenFor(id: string, purpose: 'verification' | 'receipt' | 'resend') {
    return bookingToken(bookingTokenSecret(this.config), id, purpose);
  }

  private verificationToken(request: BookingRecord) {
    return request.tokenVersion === 1
      ? this.tokenFor(request.id, 'verification')
      : request.token;
  }

  private receiptToken(request: BookingRecord) {
    return request.tokenVersion === 1
      ? this.tokenFor(request.id, 'receipt')
      : (request.receiptToken ?? this.tokenFor(request.id, 'receipt'));
  }

  private async verifiedCustomer(
    request: BookingRecord,
    client: Prisma.TransactionClient,
  ) {
    // National ID is the stable identity inside the spa. Email, phone and name
    // come from this verified request: the confirmation link already proved
    // control of the submitted inbox, so a returning guest may update contact.
    const input = {
      name: request.submittedName.trim().replace(/\s+/g, ' '),
      phone: request.submittedPhone.trim(),
      nationalId: request.nationalId,
      email: request.email.trim().toLowerCase(),
    };
    const where = {
      spaId_nationalId: { spaId: request.spaId, nationalId: input.nationalId },
    };
    await client.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`customer:${request.spaId}:${input.nationalId}`}, 0))`;
    await client.$queryRaw`SELECT "id" FROM "Customer" WHERE "spaId" = ${request.spaId}::uuid AND "nationalId" = ${input.nationalId} FOR UPDATE`;
    const customer = await client.customer.findUnique({ where });
    if (!customer) {
      return client.customer.create({ data: { spaId: request.spaId, ...input } });
    }
    if (customer.spaId !== request.spaId) {
      throw new ConflictException(
        'No se puede completar esta reserva en línea. Contacta al spa.',
      );
    }
    return client.customer.update({
      where: { id: customer.id },
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email,
      },
    });
  }

  private assertRelations(request: BookingRecord) {
    const spaId = request.spaId;
    if (
      request.spa.id !== spaId ||
      request.service.spaId !== spaId ||
      (request.customer && request.customer.spaId !== spaId) ||
      (request.appointment &&
        (request.appointment.spaId !== spaId ||
          request.appointment.serviceId !== request.serviceId ||
          request.appointment.customerId !== request.customerId)) ||
      request.visitAppointments.some(
        (appointment) =>
          appointment.spaId !== spaId ||
          appointment.customerId !== request.customerId,
      )
    ) {
      throw new NotFoundException('Enlace inválido');
    }
  }

  private async assertConfirmable(
    request: BookingRecord,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    this.assertRelations(request);
    if (!acceptsPublicBookings(request.spa))
      throw new ConflictException(
        'No se puede confirmar esta reserva. Contacta al spa.',
      );
    const segments = readSegments(request.segments);
    // Legacy single requests have no price snapshot; require a fresh request
    // rather than silently accepting an unprovable price.
    if (!segments.length)
      throw new ConflictException(
        'Solicita nuevamente la reserva para revisar sus condiciones.',
      );
    if (
      segments.length > 5 ||
      !Array.isArray(request.segments) ||
      request.segments.length !== segments.length ||
      segments[0].serviceId !== request.serviceId ||
      segments[0].start !== request.startAt.toISOString() ||
      segments[segments.length - 1].end !== request.endAt.toISOString()
    ) {
      throw new ConflictException(
        'Las condiciones de la reserva cambiaron. Solicítala nuevamente.',
      );
    }
    const categories = new Set<string>();
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      if (
        (segment.currency && segment.currency !== request.spa.currency) ||
        (segment.timezone && segment.timezone !== request.spa.timezone)
      ) {
        throw new ConflictException(
          'La configuración del spa cambió. Solicita nuevamente la reserva.',
        );
      }
      if (
        !/^\d+(?:\.\d{1,2})?$/.test(segment.price) ||
        !Number.isSafeInteger(segment.durationMinutes) ||
        segment.durationMinutes <= 0 ||
        !Number.isFinite(Date.parse(segment.start)) ||
        !Number.isFinite(Date.parse(segment.end))
      ) {
        throw new ConflictException(
          'Las condiciones de la reserva cambiaron. Solicítala nuevamente.',
        );
      }
      const service = await client.spaService.findUnique({
        where: { id_spaId: { id: segment.serviceId, spaId: request.spaId } },
      });
      if (
        !service?.isActive ||
        service.durationType !== 'FIXED' ||
        service.priceType !== 'FIXED' ||
        service.durationMinutes !== segment.durationMinutes ||
        service.categoryId !== segment.categoryId ||
        !service.price.equals(segment.price) ||
        categories.has(segment.categoryId) ||
        new Date(segment.end).getTime() - new Date(segment.start).getTime() !==
          segment.durationMinutes * 60_000 ||
        (index > 0 && segments[index - 1].end !== segment.start)
      ) {
        throw new ConflictException(
          'Las condiciones de la reserva cambiaron. Solicítala nuevamente.',
        );
      }
      categories.add(segment.categoryId);
      const category = await client.serviceCategory.findFirst({
        where: { id: segment.categoryId, spaId: request.spaId },
      });
      if (!category) throw new NotFoundException('Servicio no encontrado');
    }
    if (
      segments.length > 1 &&
      segments.some((segment) => !segment.professionalId)
    ) {
      throw new NotFoundException('Profesional no encontrada');
    }
  }

  private async byToken(token: string, confirmationRetry = false) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(token))
      throw new NotFoundException('Enlace inválido');
    let request = await this.prisma.bookingRequest.findUnique({
      where: {
        token: bookingTokenHash(token, 'verification'),
        tokenVersion: 1,
      },
      include: requestInclude,
    });
    if (!request)
      request = await this.prisma.bookingRequest.findUnique({
        where: { token, tokenVersion: 0 },
        include: requestInclude,
      });
    if (!request) throw new NotFoundException('Enlace inválido');
    this.assertRelations(request);
    if (
      request.tokenVersion === 1 &&
      request.expiresAt.getTime() <= Date.now() &&
      request.status === 'CONFIRMED' &&
      !confirmationRetry
    ) {
      throw new GoneException(
        'El enlace de verificación expiró. Usa tu comprobante.',
      );
    }
    return request;
  }

  private async byReceipt(receiptToken: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(receiptToken))
      throw new NotFoundException('Comprobante no disponible.');
    let request = await this.prisma.bookingRequest.findUnique({
      where: {
        receiptToken: bookingTokenHash(receiptToken, 'receipt'),
        tokenVersion: 1,
      },
      include: requestInclude,
    });
    if (!request)
      request = await this.prisma.bookingRequest.findUnique({
        where: { receiptToken, tokenVersion: 0 },
        include: requestInclude,
      });
    if (
      !request ||
      (!request.appointment && !request.visitAppointments.length) ||
      !['CONFIRMED', 'CANCELLED'].includes(request.status)
    )
      throw new NotFoundException('Comprobante no disponible.');
    this.assertRelations(request);
    return request;
  }

  private async assertPending(
    request: BookingRecord,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    if (
      request.status === 'EXPIRED' ||
      (request.status === 'PENDING' &&
        request.expiresAt.getTime() <= Date.now())
    ) {
      if (request.status === 'PENDING') {
        await client.bookingRequest.updateMany({
          where: {
            id: request.id,
            status: 'PENDING',
            expiresAt: { lte: new Date() },
          },
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
    if (
      request.status === 'PENDING' &&
      request.expiresAt.getTime() <= Date.now()
    ) {
      const expired = await this.prisma.bookingRequest.updateMany({
        where: {
          id: request.id,
          status: 'PENDING',
          expiresAt: { lte: new Date() },
        },
        data: { status: 'EXPIRED' },
      });
      if (!expired.count) {
        const current = await this.prisma.bookingRequest.findUniqueOrThrow({
          where: { id: request.id },
          include: requestInclude,
        });
        this.assertRelations(current);
        request = current;
      } else {
        request.status = 'EXPIRED';
      }
    }
    if (
      request.status === 'CANCELLED' ||
      (this.bookedAppointments(request).length > 0 &&
        !this.bookedAppointments(request).some((a) => a.status !== 'CANCELLED'))
    ) {
      return this.summary(request, 'CANCELLED');
    }
    if (
      request.status === 'CONFIRMED' &&
      request.receiptToken &&
      this.bookedAppointments(request).length > 0
    ) {
      return this.receipt(request, this.receiptToken(request));
    }
    return this.summary(
      request,
      request.status === 'EXPIRED' ? 'EXPIRED' : 'PENDING',
    );
  }

  private async summary(
    request: BookingRecord,
    status: 'PENDING' | 'EXPIRED' | 'CANCELLED',
  ) {
    const appointments = this.bookedAppointments(request);
    return {
      requestId: request.id,
      status,
      spaName: request.spa.name,
      timezone:
        readSegments(request.segments)[0]?.timezone ?? request.spa.timezone,
      currency:
        readSegments(request.segments)[0]?.currency ?? request.spa.currency,
      serviceNames: appointments.length
        ? appointments.map((a) => a.service.name)
        : segmentNames(request),
      professionalName:
        (appointments.length
          ? [
              ...new Set(appointments.map((a) => a.professional.displayName)),
            ].join(' / ')
          : segmentProfessionals(request)) ||
        (await this.professionalLabel(request.spaId, request.professionalId)),
      start:
        appointments[0]?.startAt.toISOString() ?? request.startAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
    };
  }

  private bookedAppointments(request: BookingRecord) {
    const rows = [
      ...(request.appointment ? [request.appointment] : []),
      ...request.visitAppointments,
    ];
    return [...new Map(rows.map((a) => [a.id, a])).values()].sort(
      (a, b) =>
        a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id),
    );
  }

  private async receipt(request: BookingRecord, receiptToken: string) {
    const all = this.bookedAppointments(request);
    const active = all.filter((a) => a.status !== 'CANCELLED');
    if (!active.length)
      throw new NotFoundException('La reserva fue cancelada.');
    const total = active.reduce(
      (sum, a) => sum.plus(a.servicePrice),
      new Prisma.Decimal(0),
    );
    const end = new Date(Math.max(...active.map((a) => a.endAt.getTime())));
    return {
      requestId: request.id,
      status: 'CONFIRMED' as const,
      spaName: request.spa.name,
      timezone: request.spa.timezone,
      currency:
        readSegments(request.segments)[0]?.currency ?? request.spa.currency,
      serviceNames: active.map((a) => a.service.name),
      professionalName: [
        ...new Set(active.map((a) => a.professional.displayName)),
      ].join(' / '),
      start: active[0].startAt.toISOString(),
      end: end.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      bookingCode: bookingCode(request.appointmentId ?? all[0].id),
      total: Number(total.toString()),
      receiptToken,
      partiallyCancelled: active.length !== all.length,
      appointments: all.map((a) => ({
        id: a.id,
        serviceName: a.service.name,
        professionalName: a.professional.displayName,
        start: a.startAt.toISOString(),
        end: a.endAt.toISOString(),
        status: a.status,
        price: Number(a.servicePrice.toString()),
      })),
    };
  }

  private async mailFor(request: BookingRecord, token: string) {
    return {
      to: request.email,
      customerName: request.submittedName,
      spaName: request.spa.name,
      serviceName: segmentNames(request).join(' · '),
      professionalName:
        segmentProfessionals(request) ||
        (await this.professionalLabel(request.spaId, request.professionalId)),
      when: formatWhen(request.startAt, request.spa.timezone),
      expiresAt: formatWhen(request.expiresAt, request.spa.timezone),
      verificationUrl: this.verificationUrl(request.spa.slug, token),
    };
  }

  private verificationUrl(slug: string, token: string) {
    const settings = readBookingUrlConfig((key) => this.config.get<string>(key));
    return publicSpaUrl(
      settings,
      slug,
      `/booking/verify?token=${encodeURIComponent(token)}`,
    );
  }

  private async professionalLabel(
    spaId: string,
    professionalId: string | null,
  ) {
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
    client?: Prisma.TransactionClient,
  ) {
    const professionals = await (client ?? this.prisma).professional.findMany({
      where: {
        spaId,
        isActive: true,
        ...(professionalId ? { id: professionalId } : {}),
        services: { some: { serviceId, spaId } },
      },
      orderBy: { displayName: 'asc' },
      select: { id: true, commissionRate: true },
    });
    for (const professional of professionals) {
      if (client) {
        await client.$queryRaw`SELECT "id" FROM "Professional" WHERE "id" = ${professional.id}::uuid AND "spaId" = ${spaId}::uuid FOR SHARE`;
        await client.$queryRaw`SELECT "professionalId" FROM "ProfessionalService" WHERE "professionalId" = ${professional.id}::uuid AND "serviceId" = ${serviceId}::uuid AND "spaId" = ${spaId}::uuid FOR SHARE`;
        const active = await client.professional.findFirst({
          where: {
            id: professional.id,
            spaId,
            isActive: true,
            services: { some: { serviceId, spaId } },
          },
        });
        if (!active) continue;
        professional.commissionRate = active.commissionRate;
        await client.$queryRaw`SELECT "id" FROM "ProfessionalSchedule" WHERE "professionalId" = ${professional.id}::uuid AND "spaId" = ${spaId}::uuid ORDER BY "id" FOR SHARE`;
      }
      const schedule = await this.scheduling.shiftCovering(
        spaId,
        professional.id,
        slot.local.weekday % 7,
        slot.startMinute,
        slot.endMinute,
        client,
      );
      if (!schedule) continue;
      const overlap = await this.scheduling.conflictingAppointment(
        {
          spaId,
          professionalId: professional.id,
          start: slot.start.toUTC().toJSDate(),
          end: slot.end.toUTC().toJSDate(),
        },
        client,
      );
      if (!overlap) return professional;
    }
    return null;
  }

  private slot(
    spa: { timezone: string; openingMinute: number; closingMinute: number },
    startAt: string,
    durationMinutes: number,
    continuation = false,
  ) {
    return this.scheduling.publicSlot(
      spa,
      startAt,
      durationMinutes,
      continuation,
    );
  }
}

function readSegments(value: Prisma.JsonValue | null): PublicSequenceSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.serviceId !== 'string' ||
      typeof row.professionalId !== 'string' ||
      typeof row.start !== 'string' ||
      typeof row.end !== 'string'
    )
      return [];
    return [
      {
        serviceId: row.serviceId,
        serviceName: typeof row.serviceName === 'string' ? row.serviceName : '',
        categoryId: typeof row.categoryId === 'string' ? row.categoryId : '',
        professionalId: row.professionalId,
        professionalName:
          typeof row.professionalName === 'string' ? row.professionalName : '',
        commissionRate:
          typeof row.commissionRate === 'string' ? row.commissionRate : '0',
        price: typeof row.price === 'string' ? row.price : '0',
        durationMinutes:
          typeof row.durationMinutes === 'number' ? row.durationMinutes : 0,
        currency:
          typeof row.currency === 'string' && /^[A-Z]{3,4}$/.test(row.currency)
            ? row.currency
            : undefined,
        timezone: typeof row.timezone === 'string' ? row.timezone : undefined,
        start: row.start,
        end: row.end,
      },
    ];
  });
}

function segmentNames(request: BookingRecord) {
  const segments = readSegments(request.segments);
  return segments.length
    ? segments.map((segment) => segment.serviceName)
    : [request.service.name];
}

function segmentProfessionals(request: BookingRecord) {
  const names = [
    ...new Set(
      readSegments(request.segments)
        .map((segment) => segment.professionalName)
        .filter(Boolean),
    ),
  ];
  return names.join(' · ');
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

