import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AvailabilityService } from '../availability/availability.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { PublicAvailabilityQueryDto } from './dto/public-availability.dto';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
export class PublicBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  async spa(slug: string) {
    const spa = await this.findSpa(slug);
    return {
      id: spa.id,
      slug: spa.slug,
      name: spa.name,
      timezone: spa.timezone,
      currency: spa.currency,
    };
  }

  async services(slug: string) {
    const spa = await this.findSpa(slug);
    const rows = await this.prisma.spaService.findMany({
      where: { spaId: spa.id, isActive: true },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
      include: { category: { select: { id: true, name: true } } },
    });
    return rows.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description ?? '',
      category: service.category.name,
      durationMinutes: service.durationMinutes,
      price: Number(service.price.toString()),
      priceFrom: service.priceType === 'VARIABLE',
      mode: service.durationType === 'VARIABLE' ? 'ESTIMATED' : 'INSTANT',
      compatibleWith: rows
        .filter((other) => other.categoryId !== service.categoryId)
        .map((other) => other.id),
    }));
  }

  async professionals(slug: string, serviceIds: string) {
    const spa = await this.findSpa(slug);
    const ids = this.ids(serviceIds);
    if (ids.length) {
      const found = await this.prisma.spaService.count({
        where: { spaId: spa.id, isActive: true, id: { in: ids } },
      });
      if (found !== ids.length) throw new NotFoundException('Servicio no encontrado');
    }
    const rows = await this.prisma.professional.findMany({
      where: {
        spaId: spa.id,
        isActive: true,
        ...(ids.length
          ? { AND: ids.map((serviceId) => ({ services: { some: { serviceId } } })) }
          : {}),
      },
      orderBy: { displayName: 'asc' },
      include: {
        services: {
          include: { service: { select: { category: { select: { name: true } } } } },
        },
      },
    });
    const listed = rows.map((professional) => {
      const categories = [
        ...new Set(professional.services.map((item) => item.service.category.name)),
      ];
      return {
        id: professional.id,
        name: professional.displayName,
        specialty: categories.join(' · ') || 'Profesional',
        serviceIds: professional.services.map((item) => item.serviceId),
        initials: initials(professional.displayName),
      };
    });
    return [
      {
        id: 'any',
        name: 'Cualquier profesional',
        specialty: 'Asignación según disponibilidad',
        serviceIds: ids,
        initials: 'VF',
      },
      ...listed,
    ];
  }

  async availability(slug: string, query: PublicAvailabilityQueryDto) {
    const spa = await this.findSpa(slug);
    const ids = this.ids(query.serviceIds);
    const services = await this.prisma.spaService.findMany({
      where: { spaId: spa.id, isActive: true, id: { in: ids } },
    });
    if (services.length !== ids.length)
      throw new NotFoundException('Servicio no encontrado');
    if (services.some((service) => service.durationType === 'VARIABLE' || service.durationMinutes == null))
      throw new BadRequestException(
        'Hay un servicio con duración variable. Elige uno de duración fija para ver horarios.',
      );
    if (services.length !== 1)
      throw new BadRequestException(
        'La disponibilidad combinada de varias categorías todavía no está disponible en la reserva pública.',
      );
    const result = await this.availabilityService.get(spa.id, {
      date: query.date,
      serviceId: services[0].id,
      professionalId: query.professionalId,
      intervalMinutes: 30,
    });
    const slots = new Map<string, { start: string; end: string; professionalIds: string[] }>();
    for (const slot of result.data) {
      if (!slot.start || !slot.end) continue;
      const current = slots.get(slot.start);
      if (current) current.professionalIds.push(slot.professionalId);
      else slots.set(slot.start, { start: slot.start, end: slot.end, professionalIds: [slot.professionalId] });
    }
    return [...slots.values()];
  }

  private ids(value: string) {
    return value.split(',').map((id) => id.trim()).filter(Boolean);
  }

  private async findSpa(slug: string) {
    if (!SLUG.test(slug)) throw new NotFoundException('Spa no encontrado');
    const spa = await this.prisma.spa.findUnique({ where: { slug } });
    if (!spa || spa.status !== 'ACTIVE') throw new NotFoundException('Spa no encontrado');
    return spa;
  }
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'P';
}
