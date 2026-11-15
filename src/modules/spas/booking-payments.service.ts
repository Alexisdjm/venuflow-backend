import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreatePaymentMethodDto,
  UpdateBookingPaymentsDto,
  UpdatePaymentMethodDto,
} from './dto/booking-payments.dto';
import {
  MAX_PAYMENT_METHODS,
  defaultRequiresProof,
  parseDepositPolicy,
  parsePaymentDetails,
  parsePaymentLabel,
  toPublicBookingPolicy,
  type RemoteDepositMode,
  type RemotePaymentMethod,
} from './booking-payments';

const methodSelect = {
  id: true,
  type: true,
  label: true,
  details: true,
  requiresProof: true,
  isActive: true,
  sortOrder: true,
} satisfies Prisma.SpaPaymentMethodSelect;

type MethodRow = Prisma.SpaPaymentMethodGetPayload<{ select: typeof methodSelect }>;

@Injectable()
export class BookingPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(spaId: string) {
    const spa = await this.policy(spaId);
    const methods = await this.prisma.spaPaymentMethod.findMany({
      where: { spaId },
      select: methodSelect,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return this.present(spa, methods);
  }

  async updatePolicy(actorUserId: string, spaId: string, dto: UpdateBookingPaymentsDto) {
    const current = await this.policy(spaId);
    const next = parseDepositPolicy({
      mode: dto.mode,
      value: dto.value,
      currency: dto.currency,
      holdMinutes: dto.holdMinutes ?? current.paymentReviewHoldMinutes,
    });
    if (next.remoteDepositMode !== 'NONE') {
      const active = await this.prisma.spaPaymentMethod.count({
        where: { spaId, isActive: true },
      });
      if (active < 1) {
        throw new ConflictException('Agrega un método de pago activo antes de pedir adelanto');
      }
    }
    const spa = await this.prisma.spa.update({
      where: { id: spaId },
      data: next,
      select: policySelect,
    });
    await this.audit.record({
      actorUserId,
      spaId,
      action: 'SPA_BOOKING_PAYMENTS_UPDATED',
      entityType: 'Spa',
      entityId: spaId,
      metadata: {
        mode: spa.remoteDepositMode,
        value: amount(spa.remoteDepositValue),
        currency: spa.remoteDepositCurrency,
        holdMinutes: spa.paymentReviewHoldMinutes,
      },
    });
    return this.get(spaId);
  }

  async createMethod(actorUserId: string, spaId: string, dto: CreatePaymentMethodDto) {
    await this.policy(spaId);
    const total = await this.prisma.spaPaymentMethod.count({ where: { spaId } });
    if (total >= MAX_PAYMENT_METHODS) {
      throw new ConflictException('Este spa ya tiene el máximo de métodos de pago');
    }
    const label = parsePaymentLabel(dto.label);
    await this.assertLabelAvailable(spaId, label);
    const last = await this.prisma.spaPaymentMethod.findFirst({
      where: { spaId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const method = await this.prisma.spaPaymentMethod.create({
      data: {
        spaId,
        type: dto.type,
        label,
        details: parsePaymentDetails(dto.type, dto.details),
        requiresProof: dto.requiresProof ?? defaultRequiresProof(dto.type),
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? (last ? last.sortOrder + 1 : 0),
      },
      select: methodSelect,
    });
    await this.audit.record({
      actorUserId,
      spaId,
      action: 'SPA_PAYMENT_METHOD_CREATED',
      entityType: 'SpaPaymentMethod',
      entityId: method.id,
      metadata: { type: method.type, label: method.label },
    });
    return method;
  }

  async updateMethod(
    actorUserId: string,
    spaId: string,
    id: string,
    dto: UpdatePaymentMethodDto,
  ) {
    const current = await this.findMethod(spaId, id);
    const type = dto.type ?? current.type;
    if (dto.type && dto.type !== current.type && dto.details === undefined) {
      throw new BadRequestException('Al cambiar el tipo hay que indicar los datos del método');
    }
    const isActive = dto.isActive ?? current.isActive;
    if (current.isActive && !isActive) await this.assertCanDeactivate(spaId, id);
    const label = dto.label === undefined ? current.label : parsePaymentLabel(dto.label);
    if (label !== current.label) await this.assertLabelAvailable(spaId, label, id);
    const method = await this.prisma.spaPaymentMethod.update({
      where: { id },
      data: {
        type,
        label,
        ...(dto.details === undefined ? {} : { details: parsePaymentDetails(type, dto.details) }),
        ...(dto.requiresProof === undefined ? {} : { requiresProof: dto.requiresProof }),
        isActive,
        ...(dto.sortOrder === undefined ? {} : { sortOrder: dto.sortOrder }),
      },
      select: methodSelect,
    });
    await this.audit.record({
      actorUserId,
      spaId,
      action: 'SPA_PAYMENT_METHOD_UPDATED',
      entityType: 'SpaPaymentMethod',
      entityId: id,
      metadata: { type: method.type, label: method.label, isActive: method.isActive },
    });
    return method;
  }

  async deleteMethod(actorUserId: string, spaId: string, id: string) {
    const current = await this.findMethod(spaId, id);
    if (current.isActive) await this.assertCanDeactivate(spaId, id);
    await this.prisma.spaPaymentMethod.delete({ where: { id } });
    await this.audit.record({
      actorUserId,
      spaId,
      action: 'SPA_PAYMENT_METHOD_DELETED',
      entityType: 'SpaPaymentMethod',
      entityId: id,
      metadata: { label: current.label },
    });
  }

  async publicPolicy(spa: {
    id: string;
    remoteDepositMode: RemoteDepositMode;
    remoteDepositValue: Prisma.Decimal | null;
    remoteDepositCurrency: string | null;
    paymentReviewHoldMinutes: number;
  }) {
    const methods = await this.prisma.spaPaymentMethod.findMany({
      where: { spaId: spa.id, isActive: true },
      select: methodSelect,
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    return toPublicBookingPolicy(
      {
        remoteDepositMode: spa.remoteDepositMode,
        remoteDepositValue: amount(spa.remoteDepositValue),
        remoteDepositCurrency: spa.remoteDepositCurrency,
        paymentReviewHoldMinutes: spa.paymentReviewHoldMinutes,
      },
      methods.map(presentMethod),
    );
  }

  private async policy(spaId: string) {
    const spa = await this.prisma.spa.findUnique({ where: { id: spaId }, select: policySelect });
    if (!spa) throw new NotFoundException('No se encontró el spa');
    return spa;
  }

  private async findMethod(spaId: string, id: string) {
    const method = await this.prisma.spaPaymentMethod.findFirst({
      where: { id, spaId },
      select: methodSelect,
    });
    if (!method) throw new NotFoundException('No se encontró el método de pago');
    return method;
  }

  private async assertLabelAvailable(spaId: string, label: string, exceptId?: string) {
    const existing = await this.prisma.spaPaymentMethod.findFirst({
      where: { spaId, label, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Ya existe un método con ese nombre');
  }

  private async assertCanDeactivate(spaId: string, id: string) {
    const spa = await this.policy(spaId);
    if (spa.remoteDepositMode === 'NONE') return;
    const active = await this.prisma.spaPaymentMethod.count({
      where: { spaId, isActive: true, id: { not: id } },
    });
    if (active < 1) {
      throw new ConflictException('El adelanto necesita al menos un método de pago activo');
    }
  }

  private present(
    spa: {
      remoteDepositMode: RemoteDepositMode;
      remoteDepositValue: Prisma.Decimal | null;
      remoteDepositCurrency: string | null;
      paymentReviewHoldMinutes: number;
    },
    methods: MethodRow[],
  ) {
    return {
      mode: spa.remoteDepositMode,
      value: amount(spa.remoteDepositValue),
      currency: spa.remoteDepositCurrency,
      holdMinutes: spa.paymentReviewHoldMinutes,
      methods: methods.map(presentMethod),
    };
  }
}

const policySelect = {
  remoteDepositMode: true,
  remoteDepositValue: true,
  remoteDepositCurrency: true,
  paymentReviewHoldMinutes: true,
} satisfies Prisma.SpaSelect;

function amount(value: Prisma.Decimal | null) {
  return value === null ? null : Number(value.toString());
}

function presentMethod(method: MethodRow) {
  return {
    id: method.id,
    type: method.type as RemotePaymentMethod,
    label: method.label,
    details: method.details,
    requiresProof: method.requiresProof,
    isActive: method.isActive,
    sortOrder: method.sortOrder,
  };
}
