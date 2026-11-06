import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import {
  isPublicSpaSlug,
  publicSpaOrigin,
  readBookingUrlConfig,
} from '../../common/public-booking-url';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CreateSpaDto, UpdateSpaDto } from './dto/spa.dto';
import { ProvisionAdminDto } from './dto/provision-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import {
  DEFAULT_SERVICE_CATEGORIES,
  normalizeCategoryName,
} from '../services/default-categories';
@Injectable()
export class SpasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly config?: ConfigService,
  ) {}
  async create(actorUserId: string, dto: CreateSpaDto) {
    this.assertPublicSlug(dto.slug);
    const spa = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.spa.create({ data: dto });
        await tx.serviceCategory.createMany({
          data: DEFAULT_SERVICE_CATEGORIES.map((name, sortOrder) => ({
            spaId: created.id,
            name,
            normalizedName: normalizeCategoryName(name),
            sortOrder,
          })),
        });
        return created;
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException('Ya existe un spa con ese identificador');
        throw error;
      });
    await this.audit.record({
      actorUserId,
      spaId: spa.id,
      action: 'SPA_CREATED',
      entityType: 'Spa',
      entityId: spa.id,
    });
    return this.withPublicUrl(spa);
  }
  async list(q: PaginationDto) {
    const skip = (q.page - 1) * q.limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.spa.findMany({
        skip,
        take: q.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.spa.count(),
    ]);
    return {
      data: data.map((spa) => this.withPublicUrl(spa)),
      meta: { page: q.page, limit: q.limit, total },
    };
  }
  async get(id: string) {
    const spa = await this.prisma.spa.findUnique({ where: { id } });
    if (!spa) throw new NotFoundException('No se encontró el spa');
    return this.withPublicUrl(spa);
  }
  async getForPlatform(id: string) {
    const spa = await this.get(id);
    const admin = await this.prisma.user.findFirst({
      where: { spaId: id, role: 'SPA_ADMIN' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
      },
    });
    return { ...spa, admin };
  }
  async update(actorUserId: string, id: string, dto: UpdateSpaDto) {
    this.assertPublicSlug(dto.slug);
    await this.get(id);
    const spa = await this.prisma.spa.update({ where: { id }, data: dto });
    await this.audit.record({
      actorUserId,
      spaId: id,
      action: 'SPA_UPDATED',
      entityType: 'Spa',
      entityId: id,
      metadata: { status: dto.status ?? null },
    });
    return this.withPublicUrl(spa);
  }
  private assertPublicSlug(slug: string | undefined) {
    if (slug !== undefined && !isPublicSpaSlug(slug)) {
      throw new BadRequestException(
        'Ese identificador no puede usarse como dirección pública',
      );
    }
  }
  private withPublicUrl<T extends { slug: string }>(spa: T) {
    try {
      const settings = readBookingUrlConfig((key) =>
        this.config?.get<string>(key),
      );
      return { ...spa, publicUrl: publicSpaOrigin(settings, spa.slug) };
    } catch {
      return { ...spa, publicUrl: null };
    }
  }
  async updateOperatingHours(
    actorUserId: string,
    spaId: string,
    openingMinute: number,
    closingMinute: number,
    walkInGraceMinutes?: number,
  ) {
    if (openingMinute >= closingMinute)
      throw new BadRequestException('La hora de apertura debe ser anterior a la de cierre');
    const scheduleOutsideHours =
      await this.prisma.professionalSchedule.findFirst({
        where: {
          spaId,
          OR: [
            { startMinute: { lt: openingMinute } },
            { endMinute: { gt: closingMinute } },
          ],
        },
      });
    if (scheduleOutsideHours)
      throw new ConflictException(
        'Ajusta las jornadas existentes antes de reducir el horario del spa',
      );
    const serviceOutsideHours = await this.prisma.spaService.findFirst({
      where: {
        spaId,
        isActive: true,
        durationMinutes: { gt: closingMinute - openingMinute },
      },
    });
    if (serviceOutsideHours)
      throw new ConflictException(
        'Ajusta la duración de los servicios antes de reducir el horario del spa',
      );
    const spa = await this.prisma.spa.update({
      where: { id: spaId },
      data: { openingMinute, closingMinute, walkInGraceMinutes },
    });
    await this.audit.record({
      actorUserId,
      spaId,
      action: 'SPA_OPERATING_HOURS_UPDATED',
      entityType: 'Spa',
      entityId: spaId,
      metadata: { openingMinute, closingMinute, walkInGraceMinutes },
    });
    return spa;
  }
  async provisionAdmin(
    actorUserId: string,
    spaId: string,
    dto: ProvisionAdminDto,
  ) {
    await this.get(spaId);
    const exists = await this.prisma.user.findFirst({
      where: { spaId, role: 'SPA_ADMIN' },
    });
    if (exists) throw new ConflictException('Este spa ya tiene una administradora');
    const admin = await this.prisma.user
      .create({
        data: {
          spaId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email.toLowerCase(),
          passwordHash: await argon2.hash(dto.password),
          role: 'SPA_ADMIN',
        },
        select: {
          id: true,
          spaId: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
        },
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException('El spa ya tiene administradora o ese correo está registrado');
        throw error;
      });
    await this.audit.record({
      actorUserId,
      spaId,
      action: 'SPA_ADMIN_PROVISIONED',
      entityType: 'User',
      entityId: admin.id,
    });
    return admin;
  }
  async updateAdmin(actorUserId: string, spaId: string, dto: UpdateAdminDto) {
    await this.get(spaId);
    const current = await this.prisma.user.findFirst({
      where: { spaId, role: 'SPA_ADMIN' },
    });
    if (!current)
      throw new NotFoundException('Este spa todavía no tiene administradora');
    const email = dto.email.trim().toLowerCase();
    const emailChanged = email !== current.email;
    const passwordChanged = Boolean(dto.password);
    const admin = await this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: current.id },
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            email,
            ...(dto.password
              ? { passwordHash: await argon2.hash(dto.password) }
              : {}),
          },
          select: {
            id: true,
            spaId: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            status: true,
            createdAt: true,
          },
        });
        if (emailChanged || passwordChanged) {
          await tx.session.updateMany({
            where: { userId: current.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        return updated;
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException('Ese correo ya está registrado');
        throw error;
      });
    await this.audit.record({
      actorUserId,
      spaId,
      action: 'SPA_ADMIN_UPDATED',
      entityType: 'User',
      entityId: admin.id,
      metadata: { emailChanged, passwordChanged },
    });
    return admin;
  }
}
