import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dto';

@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private minutes(value: string) {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  }
  private shape<T extends { startMinute: number; endMinute: number }>(row: T) {
    const time = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return {
      ...row,
      startTime: time(row.startMinute),
      endTime: time(row.endMinute),
    };
  }
  private async professional(spaId: string, id: string) {
    const value = await this.prisma.professional.findUnique({
      where: { id_spaId: { id, spaId } },
    });
    if (!value) throw new NotFoundException('Professional not found');
    return value;
  }
  async list(spaId: string, professionalId: string) {
    await this.professional(spaId, professionalId);
    return (
      await this.prisma.professionalSchedule.findMany({
        where: { spaId, professionalId },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      })
    ).map((x) => this.shape(x));
  }
  async listOwn(spaId: string, userId: string) {
    const professional = await this.prisma.professional.findFirst({
      where: { spaId, userId },
    });
    if (!professional)
      throw new NotFoundException('Professional profile not found');
    return this.list(spaId, professional.id);
  }
  async create(
    spaId: string,
    actorUserId: string,
    professionalId: string,
    dto: CreateScheduleDto,
  ) {
    await this.professional(spaId, professionalId);
    const startMinute = this.minutes(dto.startTime),
      endMinute = this.minutes(dto.endTime);
    if (startMinute >= endMinute)
      throw new BadRequestException('startTime must be before endTime');
    const overlap = await this.prisma.professionalSchedule.findFirst({
      where: {
        spaId,
        professionalId,
        dayOfWeek: dto.dayOfWeek,
        isActive: true,
        startMinute: { lt: endMinute },
        endMinute: { gt: startMinute },
      },
    });
    if (overlap)
      throw new ConflictException('Schedule overlaps an existing interval');
    const schedule = await this.prisma.professionalSchedule.create({
      data: {
        spaId,
        professionalId,
        dayOfWeek: dto.dayOfWeek,
        startMinute,
        endMinute,
      },
    });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'SCHEDULE_CREATED',
      entityType: 'ProfessionalSchedule',
      entityId: schedule.id,
      metadata: { professionalId },
    });
    return this.shape(schedule);
  }
  async update(
    spaId: string,
    actorUserId: string,
    id: string,
    dto: UpdateScheduleDto,
  ) {
    const current = await this.prisma.professionalSchedule.findUnique({
      where: { id_spaId: { id, spaId } },
    });
    if (!current) throw new NotFoundException('Schedule not found');
    const startMinute = dto.startTime
      ? this.minutes(dto.startTime)
      : current.startMinute;
    const endMinute = dto.endTime
      ? this.minutes(dto.endTime)
      : current.endMinute;
    if (startMinute >= endMinute)
      throw new BadRequestException('startTime must be before endTime');
    const active = dto.isActive ?? current.isActive;
    if (active) {
      const overlap = await this.prisma.professionalSchedule.findFirst({
        where: {
          id: { not: id },
          spaId,
          professionalId: current.professionalId,
          dayOfWeek: current.dayOfWeek,
          isActive: true,
          startMinute: { lt: endMinute },
          endMinute: { gt: startMinute },
        },
      });
      if (overlap)
        throw new ConflictException('Schedule overlaps an existing interval');
    }
    const schedule = await this.prisma.professionalSchedule.update({
      where: { id_spaId: { id, spaId } },
      data: { startMinute, endMinute, isActive: dto.isActive },
    });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'SCHEDULE_UPDATED',
      entityType: 'ProfessionalSchedule',
      entityId: id,
    });
    return this.shape(schedule);
  }
  async remove(
    spaId: string,
    actorUserId: string,
    professionalId: string,
    id: string,
  ) {
    const schedule = await this.prisma.professionalSchedule.findFirst({
      where: { id, spaId, professionalId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    await this.prisma.professionalSchedule.delete({
      where: { id_spaId: { id, spaId } },
    });
    await this.audit.record({
      spaId,
      actorUserId,
      action: 'SCHEDULE_DELETED',
      entityType: 'ProfessionalSchedule',
      entityId: id,
      metadata: { professionalId },
    });
    return { success: true };
  }
}
