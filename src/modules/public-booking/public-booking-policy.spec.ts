import {
  acceptsPublicBookings,
  publicServiceEligibility,
} from './public-booking-policy';

describe('Public booking access', () => {
  it('keeps the remote form for an active Plus spa only', () => {
    expect(acceptsPublicBookings({ status: 'ACTIVE', plan: 'PLUS' })).toBe(true);
    expect(acceptsPublicBookings({ status: 'SUSPENDED', plan: 'PLUS' })).toBe(false);
    expect(acceptsPublicBookings({ status: 'ACTIVE', plan: 'BASIC' })).toBe(false);
    expect(acceptsPublicBookings({ status: 'ACTIVE' })).toBe(false);
    expect(acceptsPublicBookings(null)).toBe(false);
  });
});

describe('Public service policy', () => {
  const fixed = {
    isActive: true,
    durationType: 'FIXED',
    durationMinutes: 30,
    priceType: 'FIXED',
  };
  it('allows fixed-price, fixed-duration services with an active professional', () => {
    expect(publicServiceEligibility(fixed)).toEqual({
      onlineBookable: true,
      unavailableReason: null,
      unavailableMessage: null,
    });
  });
  it.each([
    [{ isActive: false }, true, 'INACTIVE'],
    [{ durationType: 'VARIABLE' }, true, 'VARIABLE_DURATION'],
    [{ durationMinutes: null }, true, 'INVALID_DURATION'],
    [{ durationMinutes: 0 }, true, 'INVALID_DURATION'],
    [{ priceType: 'VARIABLE' }, true, 'VARIABLE_PRICE'],
    [{}, false, 'NO_ACTIVE_PROFESSIONAL'],
  ] as const)(
    'explains an unavailable service: %j',
    (changes, assigned, reason) => {
      const result = publicServiceEligibility(
        { ...fixed, ...changes },
        assigned,
      );
      expect(result.onlineBookable).toBe(false);
      expect(result.unavailableReason).toBe(reason);
      expect(result.unavailableMessage).toBeTruthy();
    },
  );
});
