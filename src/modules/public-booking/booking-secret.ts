import { ConfigService } from '@nestjs/config';

/** Production booking links must use their own secret. Other environments may fall back to the JWT secret. */
export function bookingTokenSecret(config?: ConfigService) {
  const dedicated = config?.get<string>('PUBLIC_BOOKING_TOKEN_SECRET')?.trim();
  const jwt = config?.get<string>('JWT_ACCESS_SECRET');
  if (config?.get<string>('VENUEFLOW_ENV') === 'production') {
    if (!dedicated || dedicated.length < 32 || dedicated === jwt) {
      throw new Error(
        'PUBLIC_BOOKING_TOKEN_SECRET must be independent from JWT_ACCESS_SECRET in production',
      );
    }
    return dedicated;
  }
  const secret = dedicated || jwt;
  if (!secret) throw new Error('Missing booking token secret');
  return secret;
}
