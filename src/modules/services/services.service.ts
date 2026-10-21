import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { CreateServiceDto, UpdateServiceDto } from './dto/service.dto';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private money(value: string) {
    const amount = new Prisma.Decimal(value);
    if (amount.lt(0))
      throw new BadRequestException('price must be zero or greater');
    return amount;
  }
  async list(spaId: string, query: PaginationDto) {
    const where = { spaId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.spaService.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.spaService.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total } };
  }
  async get(spaId: string, id: string) {
    const service = await this.prisma.spaService.findUnique({
      where: { id_spaId: { id, spaId } },
    });
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }
  async create(spaId: string, actorUserId: string, dto: CreateServiceDto) {
    const service = await this.prisma.spaService
      .create({
        data: { spaId, ...dto, price: this.money(dto.price) },
      })
      .catch((error: unknown) => {
        if (error instanceof BadRequestException) throw error;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'A service with this name already exists',
          );
        throw error;
      });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'SERVICE_CREATED',
      entityType: 'SpaService',
      entityId: service.id,
    });
    return service;
  }
  async update(
    spaId: string,
    actorUserId: string,
    id: string,
    dto: UpdateServiceDto,
  ) {
    await this.get(spaId, id);
    const service = await this.prisma.spaService.update({
      where: { id_spaId: { id, spaId } },
      data: {
        ...dto,
        price: dto.price === undefined ? undefined : this.money(dto.price),
      },
    });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'SERVICE_UPDATED',
      entityType: 'SpaService',
      entityId: id,
    });
    return service;
  }
  async assign(
    spaId: string,
    actorUserId: string,
    professionalId: string,
    serviceId: string,
  ) {
    const [professional, service] = await Promise.all([
      this.prisma.professional.findUnique({
        where: { id_spaId: { id: professionalId, spaId } },
      }),
      this.prisma.spaService.findUnique({
        where: { id_spaId: { id: serviceId, spaId } },
      }),
    ]);
    if (!professional || !service)
      throw new NotFoundException('Professional or service not found');
    const assignment = await this.prisma.professionalService.upsert({
      where: { professionalId_serviceId: { professionalId, serviceId } },
      create: { spaId, professionalId, serviceId },
      update: {},
      include: { service: true },
    });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'SERVICE_ASSIGNED',
      entityType: 'Professional',
      entityId: professionalId,
      metadata: { serviceId },
    });
    return assignment;
  }
  async unassign(
    spaId: string,
    actorUserId: string,
    professionalId: string,
    serviceId: string,
  ) {
    const assignment = await this.prisma.professionalService.findFirst({
      where: { spaId, professionalId, serviceId },
    });
    if (!assignment)
      throw new NotFoundException('Service assignment not found');
    await this.prisma.professionalService.delete({
      where: { professionalId_serviceId: { professionalId, serviceId } },
    });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'SERVICE_UNASSIGNED',
      entityType: 'Professional',
      entityId: professionalId,
      metadata: { serviceId },
    });
    return { success: true };
  }
  listForProfessional(spaId: string, professionalId: string) {
    return this.prisma.professionalService.findMany({
      where: { spaId, professionalId },
      include: { service: true },
    });
  }
  async listOwn(spaId: string, userId: string) {
    const professional = await this.prisma.professional.findFirst({
      where: { spaId, userId },
    });
    if (!professional)
      throw new NotFoundException('Professional profile not found');
    return this.listForProfessional(spaId, professional.id);
  }
}
