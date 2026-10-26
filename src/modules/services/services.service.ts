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
import { normalizeCategoryName } from './default-categories';
import {
  CreateServiceCategoryDto,
  UpdateServiceCategoryDto,
} from './dto/service-category.dto';
import { CreateServiceDto, UpdateServiceDto } from './dto/service.dto';

const categorySelection = { select: { id: true, name: true } } as const;

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private money(value: string) {
    const amount = new Prisma.Decimal(value);
    if (amount.lt(0))
      throw new BadRequestException('El precio no puede ser negativo');
    return amount;
  }
  private async validateDuration(spaId: string, durationMinutes?: number) {
    if (durationMinutes === undefined) return;
    const spa = await this.prisma.spa.findUniqueOrThrow({
      where: { id: spaId },
      select: { openingMinute: true, closingMinute: true },
    });
    const maximumDuration = spa.closingMinute - spa.openingMinute;
    if (durationMinutes > maximumDuration)
      throw new BadRequestException(
        `La duración supera el horario del spa (${maximumDuration} minutos)`,
      );
  }
  private categoryName(name: string) {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 40)
      throw new BadRequestException(
        'El nombre de la categoría debe tener entre 2 y 40 caracteres',
      );
    return { name: clean, normalizedName: normalizeCategoryName(clean) };
  }
  private async requireCategory(spaId: string, categoryId: string) {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { id: categoryId, spaId },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    return category;
  }
  async list(spaId: string, query: PaginationDto) {
    const where = { spaId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.spaService.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { name: 'asc' },
        include: { category: categorySelection },
      }),
      this.prisma.spaService.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total } };
  }
  async get(spaId: string, id: string) {
    const service = await this.prisma.spaService.findUnique({
      where: { id_spaId: { id, spaId } },
      include: { category: categorySelection },
    });
    if (!service) throw new NotFoundException('No se encontró el servicio');
    return service;
  }
  listCategories(spaId: string) {
    return this.prisma.serviceCategory.findMany({
      where: { spaId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, sortOrder: true },
    });
  }
  async createCategory(
    spaId: string,
    actorUserId: string,
    dto: CreateServiceCategoryDto,
  ) {
    const { name, normalizedName } = this.categoryName(dto.name);
    const last = await this.prisma.serviceCategory.findFirst({
      where: { spaId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const category = await this.prisma.serviceCategory
      .create({
        data: {
          spaId,
          name,
          normalizedName,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        select: { id: true, name: true, sortOrder: true },
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException('Ya existe una categoría con ese nombre');
        throw error;
      });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'SERVICE_CATEGORY_CREATED',
      entityType: 'ServiceCategory',
      entityId: category.id,
      metadata: { name },
    });
    return category;
  }
  async updateCategory(
    spaId: string,
    actorUserId: string,
    id: string,
    dto: UpdateServiceCategoryDto,
  ) {
    const current = await this.prisma.serviceCategory.findFirst({
      where: { id, spaId },
    });
    if (!current) throw new NotFoundException('Categoría no encontrada');
    const { name, normalizedName } = this.categoryName(dto.name);
    const category = await this.prisma.serviceCategory
      .update({
        where: { id },
        data: { name, normalizedName },
        select: { id: true, name: true, sortOrder: true },
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException('Ya existe una categoría con ese nombre');
        throw error;
      });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'SERVICE_CATEGORY_UPDATED',
      entityType: 'ServiceCategory',
      entityId: id,
      metadata: { name },
    });
    return category;
  }
  async deleteCategory(spaId: string, actorUserId: string, id: string) {
    const current = await this.prisma.serviceCategory.findFirst({
      where: { id, spaId },
    });
    if (!current) throw new NotFoundException('Categoría no encontrada');
    const [services, appointments] = await Promise.all([
      this.prisma.spaService.count({ where: { spaId, categoryId: id } }),
      this.prisma.appointment.count({
        where: { spaId, serviceCategoryId: id },
      }),
    ]);
    if (services || appointments)
      throw new ConflictException(
        'No se puede eliminar una categoría que ya tiene servicios o citas',
      );
    await this.prisma.serviceCategory.delete({ where: { id } });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'SERVICE_CATEGORY_DELETED',
      entityType: 'ServiceCategory',
      entityId: id,
      metadata: { name: current.name },
    });
    return { success: true };
  }
  async create(spaId: string, actorUserId: string, dto: CreateServiceDto) {
    const durationType = dto.durationType ?? 'FIXED';
    if (durationType === 'FIXED' && dto.durationMinutes === undefined)
      throw new BadRequestException(
        'Indica la duración del servicio',
      );
    await this.validateDuration(spaId, dto.durationMinutes);
    await this.requireCategory(spaId, dto.categoryId);
    const service = await this.prisma.spaService
      .create({
        data: {
          spaId,
          ...dto,
          durationType,
          priceType: dto.priceType ?? 'FIXED',
          durationMinutes:
            durationType === 'VARIABLE' ? null : dto.durationMinutes,
          price: this.money(dto.price),
        },
        include: { category: categorySelection },
      })
      .catch((error: unknown) => {
        if (error instanceof BadRequestException) throw error;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'Ya existe un servicio con ese nombre',
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
    const current = await this.get(spaId, id);
    const durationType = dto.durationType ?? current.durationType;
    const durationMinutes =
      durationType === 'VARIABLE'
        ? null
        : (dto.durationMinutes ?? current.durationMinutes);
    if (durationType === 'FIXED' && durationMinutes === null)
      throw new BadRequestException(
        'Indica la duración del servicio',
      );
    await this.validateDuration(spaId, durationMinutes ?? undefined);
    if (dto.categoryId) await this.requireCategory(spaId, dto.categoryId);
    const service = await this.prisma.spaService
      .update({
        where: { id_spaId: { id, spaId } },
        data: {
          ...dto,
          durationType,
          durationMinutes,
          price: dto.price === undefined ? undefined : this.money(dto.price),
        },
        include: { category: categorySelection },
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'Ya existe un servicio con ese nombre',
          );
        throw error;
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
      throw new NotFoundException('No se encontró la profesional o el servicio');
    const assignment = await this.prisma.professionalService.upsert({
      where: { professionalId_serviceId: { professionalId, serviceId } },
      create: { spaId, professionalId, serviceId },
      update: {},
      include: { service: { include: { category: categorySelection } } },
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
      throw new NotFoundException('No se encontró la asignación del servicio');
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
      include: { service: { include: { category: categorySelection } } },
    });
  }
  async listOwn(spaId: string, userId: string) {
    const professional = await this.prisma.professional.findFirst({
      where: { spaId, userId },
    });
    if (!professional)
      throw new NotFoundException('No se encontró el perfil profesional');
    return this.listForProfessional(spaId, professional.id);
  }
}
