import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { isPublicSpaSlug } from '../../common/public-booking-url';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import {
  DEFAULT_SERVICE_CATEGORIES,
  normalizeCategoryName,
} from '../services/default-categories';
import { IMPLICIT_CATEGORY_NAME, businessCapabilities } from '../spas/business-kind';
import { CreateTrialDto } from './dto/create-trial.dto';
import { trialPlace } from './trial-places';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

@Injectable()
export class TrialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async slugAvailable(slug: string) {
    const clean = slug.trim().toLowerCase();
    if (!isPublicSpaSlug(clean)) return { available: false };
    const existing = await this.prisma.spa.findUnique({ where: { slug: clean }, select: { id: true } });
    return { available: !existing };
  }

  async create(dto: CreateTrialDto, ipAddress: string) {
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone;
    const place = trialPlace(dto.country);
    if (!place) throw new BadRequestException('Elige el país del spa.');
    const extras = (dto.extraProfessionals ?? []).map((person) => ({
      name: person.name.trim().replace(/\s+/g, ' '),
      email: person.email.trim().toLowerCase(),
      phone: person.phone,
    }));
    if (!dto.ownerProvidesService && extras.length === 0) {
      throw new BadRequestException('Indica al menos una persona que atiende.');
    }
    if (extras.some((person) => person.email === email)) {
      throw new BadRequestException('Usa un correo distinto para cada profesional.');
    }
    if (new Set(extras.map((person) => person.email)).size !== extras.length) {
      throw new BadRequestException('Cada profesional necesita un correo distinto.');
    }
    if (extras.some((person) => person.phone === phone) || new Set(extras.map((person) => person.phone)).size !== extras.length) {
      throw new BadRequestException('Cada profesional necesita un teléfono distinto.');
    }
    const fullCatalog = businessCapabilities(dto.kind).serviceCategories;
    if (fullCatalog && dto.services.some((service) => !service.category)) {
      throw new BadRequestException('Elige una categoría de la lista.');
    }
    const names = new Set(dto.services.map((service) => service.name.trim().toLocaleLowerCase('es')));
    if (names.size !== dto.services.length) {
      throw new BadRequestException('Los servicios deben tener nombres distintos.');
    }
    await this.assertAllowed(email, phone, ipAddress, extras.map((person) => person.email));

    const passwordHash = await argon2.hash(dto.password);
    let created: { adminId: string; spaId: string } | undefined;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const spa = await tx.spa.create({
          data: {
            name: dto.spaName.trim().replace(/\s+/g, ' '),
            slug: dto.slug,
            timezone: place.timezone,
            currency: place.currency,
            plan: 'DEMO',
            kind: dto.kind,
            status: 'ACTIVE',
          },
        });
        const categoryNames = fullCatalog ? DEFAULT_SERVICE_CATEGORIES : [IMPLICIT_CATEGORY_NAME];
        await tx.serviceCategory.createMany({
          data: categoryNames.map((name, sortOrder) => ({
            spaId: spa.id,
            name,
            normalizedName: normalizeCategoryName(name),
            sortOrder,
          })),
        });
        const categories = await tx.serviceCategory.findMany({ where: { spaId: spa.id } });
        const admin = await tx.user.create({
          data: {
            spaId: spa.id,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            email,
            passwordHash,
            role: 'SPA_ADMIN',
          },
        });
        const professionalIds: string[] = [];
        if (dto.ownerProvidesService) {
          const owner = await tx.professional.create({
            data: {
              spaId: spa.id,
              userId: admin.id,
              displayName: `${dto.firstName.trim()} ${dto.lastName.trim()}`,
              phone,
              commissionRate: new Prisma.Decimal(0),
            },
          });
          professionalIds.push(owner.id);
        }
        for (const person of extras) {
          const [first, ...rest] = person.name.split(' ');
          const extraUser = await tx.user.create({
            data: {
              spaId: spa.id,
              firstName: first,
              lastName: rest.join(' ') || 'Profesional',
              email: person.email,
              passwordHash: await argon2.hash(randomBytes(24).toString('base64url')),
              role: 'PROFESSIONAL',
            },
          });
          const professional = await tx.professional.create({
            data: {
              spaId: spa.id,
              userId: extraUser.id,
              displayName: person.name,
              phone: person.phone,
              commissionRate: new Prisma.Decimal(0),
            },
          });
          professionalIds.push(professional.id);
        }
        for (const service of dto.services) {
          const category = fullCatalog
            ? categories.find((item) => item.name === service.category)
            : categories[0];
          if (!category) throw new BadRequestException('Elige una categoría de la lista.');
          const created = await tx.spaService.create({
            data: {
              spaId: spa.id,
              name: service.name.trim().replace(/\s+/g, ' '),
              categoryId: category.id,
              durationType: 'FIXED',
              durationMinutes: service.durationMinutes,
              priceType: 'FIXED',
              price: new Prisma.Decimal(service.price.toFixed(2)),
            },
          });
          await tx.professionalService.createMany({
            data: professionalIds.map((professionalId) => ({
              spaId: spa.id,
              professionalId,
              serviceId: created.id,
            })),
          });
        }
        await tx.professionalSchedule.createMany({
          data: professionalIds.flatMap((professionalId) =>
            [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
              spaId: spa.id,
              professionalId,
              dayOfWeek,
              startMinute: 540,
              endMinute: 1080,
            })),
          ),
        });
        await tx.trialSignup.create({
          data: { spaId: spa.id, email, phone, ipAddress },
        });
        return { adminId: admin.id, spaId: spa.id };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target ?? '');
        if (target.includes('slug')) throw new ConflictException('Ya existe un spa con esa dirección.');
        if (target.includes('phone')) throw new ConflictException('Este teléfono ya tiene una prueba.');
        if (target.includes('email')) throw new ConflictException('Ese correo ya está registrado.');
        throw new ConflictException('No se pudo crear la prueba con esos datos.');
      }
      throw error;
    }

    await this.audit.record({
      actorUserId: created?.adminId,
      spaId: created?.spaId,
      action: 'TRIAL_STARTED',
      entityType: 'Spa',
      entityId: created?.spaId,
      metadata: {
        country: dto.country,
        plan: 'DEMO',
        extraProfessionals: extras.length,
      },
    });
    return this.auth.login({ email, password: dto.password });
  }

  private async assertAllowed(
    email: string,
    phone: string,
    ipAddress: string,
    extraEmails: string[] = [],
  ) {
    const [user, extraUsers, phoneUsed, dayCount, weekCount] = await Promise.all([
      this.prisma.user.findUnique({ where: { email }, select: { id: true } }),
      extraEmails.length
        ? this.prisma.user.findMany({ where: { email: { in: extraEmails } }, select: { id: true } })
        : Promise.resolve([]),
      this.prisma.trialSignup.findUnique({ where: { phone }, select: { id: true } }),
      this.prisma.trialSignup.count({
        where: { ipAddress, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
      }),
      this.prisma.trialSignup.count({
        where: { ipAddress, createdAt: { gte: new Date(Date.now() - WEEK_MS) } },
      }),
    ]);
    if (user) throw new ConflictException('Ese correo ya está registrado.');
    if (extraUsers.length) throw new ConflictException('El correo de una profesional ya está registrado.');
    if (phoneUsed) throw new ConflictException('Este teléfono ya tiene una prueba.');
    if (dayCount >= 1) {
      throw new ConflictException('Ya se abrió una prueba desde esta conexión. Puedes intentar de nuevo mañana.');
    }
    if (weekCount >= 3) {
      throw new ConflictException('Esta conexión ya abrió varias pruebas esta semana.');
    }
  }
}
