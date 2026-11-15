import { DateTime } from 'luxon';
import { isPayoutDay, minutesUntil } from './spa-notifications';
import { SpaNotificationsService } from './spa-notifications.service';

describe('spa notifications', () => {
  const monday = DateTime.fromISO('2026-11-16T15:00:00', { zone: 'America/Caracas' }).toUTC().toJSDate();

  it('uses Monday for weekly, even weeks for biweekly, and the first for monthly', () => {
    expect(isPayoutDay(monday, 'America/Caracas', 'NONE')).toBe(false);
    expect(isPayoutDay(monday, 'America/Caracas', 'WEEKLY')).toBe(true);
    expect(isPayoutDay(monday, 'America/Caracas', 'MONTHLY')).toBe(false);
    const week = DateTime.fromJSDate(monday, { zone: 'utc' }).setZone('America/Caracas').weekNumber;
    expect(isPayoutDay(monday, 'America/Caracas', 'BIWEEKLY')).toBe(week % 2 === 0);
    const first = DateTime.fromISO('2026-12-01T10:00:00', { zone: 'America/Caracas' }).toUTC().toJSDate();
    expect(isPayoutDay(first, 'America/Caracas', 'MONTHLY')).toBe(true);
    expect(isPayoutDay(monday, 'America/Caracas', 'WEEKLY')).toBe(true);
    const sunday = DateTime.fromISO('2026-11-15T15:00:00', { zone: 'America/Caracas' }).toUTC().toJSDate();
    expect(isPayoutDay(sunday, 'America/Caracas', 'WEEKLY')).toBe(false);
  });

  it('rounds the remaining minutes up', () => {
    const now = new Date('2026-11-16T14:00:30.000Z');
    expect(minutesUntil(new Date('2026-11-16T14:29:10.000Z'), now)).toBe(29);
  });

  it('lists a payment, a remote appointment and the payout day', async () => {
    const start = new Date(monday.getTime() + 20 * 60_000);
    const prisma = {
      spa: {
        findUnique: jest.fn().mockResolvedValue({
          timezone: 'America/Caracas',
          plan: 'PLUS',
          professionalPayoutCadence: 'WEEKLY',
        }),
      },
      bookingRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(2),
      },
      appointment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'appt-1',
            customerName: 'Ana Prueba',
            startAt: start,
            service: { name: 'Manos Sencillas' },
            professional: { displayName: 'Jenny G' },
          },
        ]),
      },
    };
    const service = new SpaNotificationsService(prisma as never);

    const feed = await service.feed('spa-1', monday);

    expect(feed.items.map((item) => item.type)).toEqual([
      'PAYMENT_REVIEW',
      'REMOTE_APPOINTMENT',
      'PROFESSIONAL_PAYOUT',
    ]);
    expect(feed.items[0].href).toBe('/dashboard/requests');
    expect(feed.items[1].title).toContain('Ana Prueba');
    expect(feed.items[2].href).toBe('/dashboard/audit');
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isWalkIn: false,
          OR: [{ bookingRequest: { isNot: null } }, { visitRequestId: { not: null } }],
        }),
      }),
    );
  });

  it('keeps the payout reminder without a finance link on the demo plan', async () => {
    const prisma = {
      spa: {
        findUnique: jest.fn().mockResolvedValue({
          timezone: 'America/Caracas',
          plan: 'DEMO',
          professionalPayoutCadence: 'WEEKLY',
        }),
      },
      bookingRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new SpaNotificationsService(prisma as never);

    const feed = await service.feed('spa-1', monday);

    expect(feed.includesFinance).toBe(false);
    expect(feed.items).toEqual([
      expect.objectContaining({ type: 'PROFESSIONAL_PAYOUT', href: null }),
    ]);
  });
});
