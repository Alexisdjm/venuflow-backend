import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import {
  CreateProfessionalDto,
  CreateOwnProfessionalDto,
  UpdateProfessionalDto,
} from './dto/professional.dto';
@Injectable()
export class ProfessionalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private rate(value: string) {
    const n = new Prisma.Decimal(value);
    if (n.lt(0) || n.gt(100))
      throw new BadRequestException('La comisión debe estar entre 0 y 100');
    return n;
  }
  async list(spaId: string, q: PaginationDto) {
    const skip = (q.page - 1) * q.limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.professional.findMany({
        where: { spaId },
        skip,
        take: q.limit,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              status: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.professional.count({ where: { spaId } }),
    ]);
    return { data, meta: { page: q.page, limit: q.limit, total } };
  }
  async get(spaId: string, id: string) {
    const p = await this.prisma.professional.findUnique({
      where: { id_spaId: { id, spaId } },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            status: true,
            role: true,
          },
        },
      },
    });
    if (!p) throw new NotFoundException('No se encontró la profesional');
    return p;
  }
  async own(spaId: string, userId: string) {
    const p = await this.prisma.professional.findFirst({
      where: { spaId, userId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            status: true,
            role: true,
          },
        },
      },
    });
    if (!p) throw new NotFoundException('No se encontró el perfil profesional');
    return p;
  }
  async create(spaId: string, actorUserId: string, d: CreateProfessionalDto) {
    const professional = await this.prisma
      .$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            spaId,
            firstName: d.firstName,
            lastName: d.lastName,
            email: d.email.toLowerCase(),
            passwordHash: await argon2.hash(d.password),
            role: 'PROFESSIONAL',
          },
        });
        return tx.professional.create({
          data: {
            spaId,
            userId: user.id,
            displayName: d.displayName,
            commissionRate: this.rate(d.commissionRate),
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                status: true,
              },
            },
          },
        });
      })
      .catch((error: unknown) => {
        if (error instanceof BadRequestException) throw error;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException('Ese correo ya está registrado');
        throw error;
      });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'PROFESSIONAL_CREATED',
      entityType: 'Professional',
      entityId: professional.id,
    });
    return professional;
  }
  async createForAdmin(
    spaId: string,
    actorUserId: string,
    d: CreateOwnProfessionalDto,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: actorUserId, spaId, role: 'SPA_ADMIN' },
    });
    if (!user) throw new NotFoundException('No se encontró la administradora');
    const exists = await this.prisma.professional.findUnique({
      where: { userId: actorUserId },
    });
    if (exists)
      throw new ConflictException(
        'La administradora ya tiene un perfil profesional',
      );
    const professional = await this.prisma.professional.create({
      data: {
        spaId,
        userId: actorUserId,
        displayName: d.displayName,
        commissionRate: this.rate(d.commissionRate),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            status: true,
            role: true,
          },
        },
      },
    });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'SPA_ADMIN_PROFESSIONAL_PROFILE_CREATED',
      entityType: 'Professional',
      entityId: professional.id,
    });
    return professional;
  }
  async update(
    spaId: string,
    actorUserId: string,
    id: string,
    d: UpdateProfessionalDto,
  ) {
    const current = await this.get(spaId, id);
    const professional = await this.prisma.$transaction(async (tx) => {
      if (d.isActive !== undefined && current.user.role === 'PROFESSIONAL') {
        await tx.user.update({
          where: { id_spaId: { id: current.userId, spaId } },
          data: { status: d.isActive ? 'ACTIVE' : 'SUSPENDED' },
        });
      }
      return tx.professional.update({
        where: { id_spaId: { id, spaId } },
        data: {
          displayName: d.displayName,
          isActive: d.isActive,
          commissionRate:
            d.commissionRate === undefined
              ? undefined
              : this.rate(d.commissionRate),
        },
      });
    });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'PROFESSIONAL_UPDATED',
      entityType: 'Professional',
      entityId: id,
      metadata: { isActive: d.isActive ?? null },
    });
    return professional;
  }
  async resetPassword(
    spaId: string,
    actorUserId: string,
    id: string,
    password: string,
  ) {
    const current = await this.get(spaId, id);
    if (current.user.role !== 'PROFESSIONAL') {
      throw new BadRequestException(
        'Solo puedes restablecer la contraseña de una profesional',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id_spaId: { id: current.userId, spaId } },
        data: { passwordHash: await argon2.hash(password) },
      });
      await tx.session.updateMany({
        where: { userId: current.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'PROFESSIONAL_PASSWORD_RESET',
      entityType: 'User',
      entityId: current.userId,
    });
    return { success: true };
  }
}
