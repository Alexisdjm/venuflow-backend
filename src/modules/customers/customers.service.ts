import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { CustomerQueryDto } from './dto/customer-query.dto';
import {
  AssignPackageDto,
  PackagePaymentDto,
} from './dto/customer-package.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { PackageInactivityService } from './package-inactivity.service';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly inactivity?: PackageInactivityService,
  ) {}

  async list(spaId: string, query: CustomerQueryDto) {
    const spa = await this.prisma.spa.findUniqueOrThrow({
      where: { id: spaId },
      select: { timezone: true },
    });
    let appointmentFilter = {};
    if (query.period !== 'all') {
      const now = DateTime.now().setZone(spa.timezone);
      const start =
        query.period === 'day'
          ? now.startOf('day')
          : query.period === 'week'
            ? now.startOf('week')
            : now.startOf('month');
      appointmentFilter = {
        appointments: {
          some: {
            startAt: {
              gte: start.toUTC().toJSDate(),
              lt: now.plus({ days: 1 }).startOf('day').toUTC().toJSDate(),
            },
          },
        },
      };
    }
    const search = query.search?.trim();
    const where = {
      spaId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { nationalId: { contains: search } },
              { phone: { contains: search } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...appointmentFilter,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: {
              appointments: { where: { status: 'COMPLETED' } },
            },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total } };
  }

  async get(spaId: string, id: string) {
    await this.inactivity?.sweep(spaId);
    const customer = await this.prisma.customer.findUnique({
      where: { id_spaId: { id, spaId } },
      include: {
        _count: {
          select: {
            appointments: { where: { status: 'COMPLETED' } },
          },
        },
        appointments: {
          orderBy: { startAt: 'desc' },
          include: {
            service: { select: { name: true } },
            professional: { select: { displayName: true } },
          },
        },
        customerPackages: {
          orderBy: { purchasedAt: 'desc' },
          include: {
            payments: { orderBy: { createdAt: 'asc' } },
            appointments: { select: { status: true, startAt: true } },
          },
        },
      },
    });
    if (!customer) throw new NotFoundException('No se encontró el cliente');
    const { customerPackages, ...rest } = customer;
    return {
      ...rest,
      packages: customerPackages.map((pack) => this.presentPackage(pack)),
    };
  }

  async update(
    spaId: string,
    actorUserId: string,
    id: string,
    dto: UpdateCustomerDto,
  ) {
    await this.get(spaId, id);
    const customer = await this.prisma.customer
      .update({ where: { id_spaId: { id, spaId } }, data: dto })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'Ya existe un cliente con esa cédula',
          );
        throw error;
      });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'CUSTOMER_UPDATED',
      entityType: 'Customer',
      entityId: id,
    });
    return customer;
  }

  async remove(spaId: string, actorUserId: string, id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id_spaId: { id, spaId } },
      select: {
        id: true,
        name: true,
        nationalId: true,
      },
    });
    if (!customer) throw new NotFoundException('No se encontró el cliente');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.appointment.deleteMany({
          where: { customerId: id, spaId, status: { not: 'COMPLETED' } },
        });
        await tx.customer.delete({ where: { id_spaId: { id, spaId } } });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      )
        throw new ConflictException(
          'No se puede eliminar un cliente con citas completadas o paquetes de sesiones',
        );
      throw error;
    }
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'CUSTOMER_DELETED',
      entityType: 'Customer',
      entityId: id,
      metadata: {
        name: customer.name,
        nationalId: customer.nationalId,
      },
    });
    return { success: true };
  }

  async assignPackage(
    spaId: string,
    actorUserId: string,
    customerId: string,
    dto: AssignPackageDto,
  ) {
    await this.get(spaId, customerId);
    const service = await this.prisma.spaService.findUnique({
      where: { id_spaId: { id: dto.serviceId, spaId } },
    });
    if (!service?.isActive || service.offering !== 'PACKAGE')
      throw new BadRequestException(
        'Elige un servicio activo de varias sesiones.',
      );
    const price = service.price;
    const paid = this.optionalMoney(dto.paidAmount, price);
    const expiresAt = service.validityDays
      ? DateTime.now().plus({ days: service.validityDays }).toJSDate()
      : null;
    const created = await this.prisma.$transaction(async (tx) => {
      const pack = await tx.customerPackage.create({
        data: {
          spaId,
          customerId,
          serviceId: service.id,
          name: service.name,
          sessionCount: service.sessionCount,
          price,
          sessionValue: price.div(service.sessionCount).toDecimalPlaces(2),
          expiresAt,
        },
      });
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
      metadata: { customerId, serviceId: service.id },
    });
    return this.presentPackage(created);
  }

  async payPackage(
    spaId: string,
    actorUserId: string,
    customerId: string,
    packageId: string,
    dto: PackagePaymentDto,
  ) {
    const pack = await this.prisma.customerPackage.findFirst({
      where: { id: packageId, spaId, customerId },
      include: { payments: true },
    });
    if (!pack) throw new NotFoundException('No se encontró el paquete');
    if (pack.cancelledAt)
      throw new ConflictException('Ese paquete está cancelado.');
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0))
      throw new BadRequestException('El abono tiene que ser mayor que cero.');
    const paid = pack.payments.reduce(
      (sum, payment) => sum.plus(payment.amount),
      new Prisma.Decimal(0),
    );
    if (paid.plus(amount).greaterThan(pack.price))
      throw new BadRequestException('El abono supera el saldo del paquete.');
    const payment = await this.prisma.packagePayment.create({
      data: { spaId, customerPackageId: pack.id, amount },
    });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'CUSTOMER_PACKAGE_PAYMENT',
      entityType: 'PackagePayment',
      entityId: payment.id,
      metadata: { customerId, customerPackageId: pack.id },
    });
    return payment;
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

  private presentPackage(pack: {
    id: string;
    serviceId: string;
    name: string;
    sessionCount: number;
    price: Prisma.Decimal;
    sessionValue: Prisma.Decimal;
    purchasedAt: Date;
    expiresAt: Date | null;
    cancelledAt: Date | null;
    inactivityDays?: number | null;
    maxReschedules?: number;
    payments: { id: string; amount: Prisma.Decimal; createdAt: Date }[];
    sessionsPerWeek: number;
    preferredWeekdays: number[];
    appointments: { status: string; startAt: Date }[];
  }) {
    const completed = pack.appointments.filter(
      (appointment) => appointment.status === 'COMPLETED',
    ).length;
    const scheduled = pack.appointments.filter(
      (appointment) => appointment.status === 'CONFIRMED',
    ).length;
    const paid = pack.payments.reduce(
      (sum, payment) => sum.plus(payment.amount),
      new Prisma.Decimal(0),
    );
    return {
      id: pack.id,
      serviceId: pack.serviceId,
      name: pack.name,
      sessionCount: pack.sessionCount,
      completed,
      scheduled,
      available: pack.sessionCount - completed - scheduled,
      price: pack.price.toFixed(2),
      sessionValue: pack.sessionValue.toFixed(2),
      paid: paid.toFixed(2),
      balance: pack.price.minus(paid).toFixed(2),
      sessionsPerWeek: pack.sessionsPerWeek,
      preferredWeekdays: pack.preferredWeekdays,
      inactivityDays: pack.inactivityDays ?? null,
      maxReschedules: pack.maxReschedules ?? 2,
      schedule: pack.appointments
        .filter((appointment) => appointment.status === 'CONFIRMED')
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
        .slice(0, 8)
        .map((appointment) => appointment.startAt),
      purchasedAt: pack.purchasedAt,
      expiresAt: pack.expiresAt,
      cancelledAt: pack.cancelledAt,
      payments: pack.payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount.toFixed(2),
        createdAt: payment.createdAt,
      })),
    };
  }
}
