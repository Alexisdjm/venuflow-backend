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
import {
  CreateProfessionalDto,
  UpdateProfessionalDto,
} from './dto/professional.dto';
@Injectable()
export class ProfessionalsService {
  constructor(private readonly prisma: PrismaService) {}
  private rate(value: string) {
    const n = new Prisma.Decimal(value);
    if (n.lt(0) || n.gt(100))
      throw new BadRequestException('commissionRate must be between 0 and 100');
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
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Professional not found');
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
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Professional profile not found');
    return p;
  }
  async create(spaId: string, d: CreateProfessionalDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
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
      });
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new ConflictException('Email already exists');
    }
  }
  async update(spaId: string, id: string, d: UpdateProfessionalDto) {
    const current = await this.get(spaId, id);
    return this.prisma.$transaction(async (tx) => {
      if (d.isActive !== undefined) {
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
  }
}
