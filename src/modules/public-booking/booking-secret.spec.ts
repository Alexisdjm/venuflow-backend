import { bookingTokenSecret } from './booking-secret';

function config(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as never;
}

describe('bookingTokenSecret', () => {
  it('falls back to the JWT secret outside production', () => {
    expect(bookingTokenSecret(config({ JWT_ACCESS_SECRET: 'jwt-secret-with-32-characters-min' }))).toBe(
      'jwt-secret-with-32-characters-min',
    );
  });

  it('requires an independent booking secret in production', () => {
    const jwt = 'jwt-secret-with-32-characters-min';
    const booking = 'booking-secret-with-32-characters';
    expect(
      bookingTokenSecret(
        config({
          VENUEFLOW_ENV: 'production',
          JWT_ACCESS_SECRET: jwt,
          PUBLIC_BOOKING_TOKEN_SECRET: booking,
        }),
      ),
    ).toBe(booking);
    expect(() =>
      bookingTokenSecret(
        config({ VENUEFLOW_ENV: 'production', JWT_ACCESS_SECRET: jwt, PUBLIC_BOOKING_TOKEN_SECRET: jwt }),
      ),
    ).toThrow(/independent/);
    expect(() =>
      bookingTokenSecret(config({ VENUEFLOW_ENV: 'production', JWT_ACCESS_SECRET: jwt })),
    ).toThrow(/independent/);
  });
});
