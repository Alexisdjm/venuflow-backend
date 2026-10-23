import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SchedulesService } from './schedules.service';

describe('SchedulesService', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const professional = { id: 'professional-id', spaId: 'spa-id' };
  const operatingHours = { openingMinute: 540, closingMinute: 1080 };

  beforeEach(() => jest.clearAllMocks());

  function createPrisma(overrides: Record<string, unknown> = {}) {
    return {
      professional: {
        findUnique: jest.fn().mockResolvedValue(professional),
      },
      spa: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(operatingHours),
      },
      professionalSchedule: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'schedule-id',
          startMinute: 540,
          endMinute: 1020,
        }),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides,
    };
  }

  it('rejects schedules whose start is not before the end', async () => {
    const prisma = createPrisma();
    const service = new SchedulesService(prisma as never, audit as never);

    await expect(
      service.create('spa-id', 'actor-id', professional.id, {
        dayOfWeek: 1,
        startTime: '18:00',
        endTime: '09:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects schedules outside spa operating hours', async () => {
    const prisma = createPrisma();
    const service = new SchedulesService(prisma as never, audit as never);

    await expect(
      service.create('spa-id', 'actor-id', professional.id, {
        dayOfWeek: 1,
        startTime: '08:30',
        endTime: '17:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects overlapping active schedules', async () => {
    const prisma = createPrisma();
    prisma.professionalSchedule.findFirst.mockResolvedValue({ id: 'existing' });
    const service = new SchedulesService(prisma as never, audit as never);

    await expect(
      service.create('spa-id', 'actor-id', professional.id, {
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '17:00',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates and shapes a valid schedule', async () => {
    const prisma = createPrisma();
    const service = new SchedulesService(prisma as never, audit as never);

    await expect(
      service.create('spa-id', 'actor-id', professional.id, {
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '17:00',
      }),
    ).resolves.toMatchObject({ startTime: '09:00', endTime: '17:00' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SCHEDULE_CREATED' }),
    );
  });

  it('rejects updates for schedules outside the current tenant', async () => {
    const prisma = createPrisma();
    prisma.professionalSchedule.findUnique.mockResolvedValue(null);
    const service = new SchedulesService(prisma as never, audit as never);

    await expect(
      service.update('spa-id', 'actor-id', 'missing-id', {
        startTime: '10:00',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates a valid schedule and preserves omitted values', async () => {
    const prisma = createPrisma();
    prisma.professionalSchedule.findUnique.mockResolvedValue({
      id: 'schedule-id',
      spaId: 'spa-id',
      professionalId: professional.id,
      dayOfWeek: 1,
      startMinute: 540,
      endMinute: 1020,
      isActive: true,
    });
    prisma.professionalSchedule.update.mockResolvedValue({
      id: 'schedule-id',
      startMinute: 600,
      endMinute: 1020,
      isActive: true,
    });
    const service = new SchedulesService(prisma as never, audit as never);

    await expect(
      service.update('spa-id', 'actor-id', 'schedule-id', {
        startTime: '10:00',
      }),
    ).resolves.toMatchObject({ startTime: '10:00', endTime: '17:00' });
    expect(prisma.professionalSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ startMinute: 600, endMinute: 1020 }),
      }),
    );
  });

  it('requires the professional id when deleting a schedule', async () => {
    const prisma = createPrisma();
    const service = new SchedulesService(prisma as never, audit as never);

    await expect(
      service.remove('spa-id', 'actor-id', professional.id, 'missing-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.professionalSchedule.delete).not.toHaveBeenCalled();
  });
});
