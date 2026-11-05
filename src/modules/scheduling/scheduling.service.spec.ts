import { BadRequestException, ConflictException } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  SchedulingService,
  professionalBusy,
  publicStartMinutes,
  rangesOverlap,
  sequenceStaysOpen,
} from './scheduling.service';

const spa = {
  timezone: 'UTC',
  openingMinute: 540,
  closingMinute: 1080,
  walkInGraceMinutes: 5,
};

describe('SchedulingService', () => {
  const prisma = {
    appointment: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const scheduling = new SchedulingService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('accepts a slot inside the spa hours', () => {
    const slot = scheduling.dashboardSlot(spa, '2099-10-20T10:00:00.000Z', 60);
    expect(slot.startMinute).toBe(600);
    expect(slot.endMinute).toBe(660);
    expect(slot.isWalkIn).toBe(false);
  });

  it('rejects a slot that leaves the spa hours', () => {
    expect(() =>
      scheduling.dashboardSlot(spa, '2099-10-20T17:30:00.000Z', 60),
    ).toThrow(ConflictException);
  });

  it('keeps a recent walk-in inside the grace period', () => {
    jest.useFakeTimers().setSystemTime(new Date('2099-10-20T10:02:00.000Z'));
    const slot = scheduling.dashboardSlot(spa, '2099-10-20T10:00:00.000Z', 60);
    expect(slot.isWalkIn).toBe(true);
    jest.useRealTimers();
  });

  it('rejects a walk-in past the grace period', () => {
    jest.useFakeTimers().setSystemTime(new Date('2099-10-20T10:06:00.000Z'));
    expect(() =>
      scheduling.dashboardSlot(spa, '2099-10-20T10:00:00.000Z', 60),
    ).toThrow(BadRequestException);
    jest.useRealTimers();
  });

  it('rejects any past slot on the public form', () => {
    expect(() =>
      scheduling.publicSlot(spa, '2020-10-20T10:00:00.000Z', 60),
    ).toThrow('El horario ya pasó.');
  });

  it('treats every appointment that is not cancelled as busy', async () => {
    await scheduling.conflictingAppointment({
      spaId: 'spa',
      professionalId: 'pro',
      start: new Date('2099-10-20T10:00:00.000Z'),
      end: new Date('2099-10-20T11:00:00.000Z'),
    });
    expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: { not: 'CANCELLED' },
        professionalId: 'pro',
      }),
    });
  });

  it('detects an in-memory overlap for the same professional', () => {
    const start = new Date('2099-10-20T10:00:00.000Z');
    const end = new Date('2099-10-20T11:00:00.000Z');
    expect(rangesOverlap(start, end, end, new Date('2099-10-20T12:00:00.000Z'))).toBe(
      false,
    );
    expect(
      professionalBusy(
        [{ professionalId: 'pro', startAt: start, endAt: end }],
        'pro',
        new Date('2099-10-20T10:30:00.000Z'),
        new Date('2099-10-20T11:30:00.000Z'),
      ),
    ).toBe(true);
  });

  it('requires the whole sequence to stay inside the same opening window', () => {
    const localDate = DateTime.fromISO('2099-10-20T00:00:00.000Z', { zone: 'UTC' });
    expect(
      sequenceStaysOpen({
        start: localDate.plus({ minutes: 540 }),
        localDate,
        totalMinutes: 90,
        openingMinute: 540,
        closingMinute: 1080,
      }),
    ).toBe(true);
    expect(
      sequenceStaysOpen({
        start: localDate.plus({ minutes: 1020 }),
        localDate,
        totalMinutes: 90,
        openingMinute: 540,
        closingMinute: 1080,
      }),
    ).toBe(false);
  });

  it('starts public sequences on the next 30-minute mark inside the window', () => {
    expect(publicStartMinutes(540, 1080, 90)[0]).toBe(540);
    expect(publicStartMinutes(555, 1080, 60)).toEqual(
      expect.arrayContaining([570]),
    );
    expect(publicStartMinutes(555, 1080, 60).every((minute) => minute % 30 === 0)).toBe(
      true,
    );
    expect(publicStartMinutes(555, 1080, 60).at(-1)).toBeLessThanOrEqual(1020);
  });
});
