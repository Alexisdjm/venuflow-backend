import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
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
            'A customer with this national ID already exists',
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
    if (!customer) throw new NotFoundException('Customer not found');
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
          'No se puede eliminar un cliente que ya tiene servicios completados',
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
}
