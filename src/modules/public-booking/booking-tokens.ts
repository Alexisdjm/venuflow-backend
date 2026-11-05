import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

type Purpose = 'verification' | 'receipt' | 'resend';

/** Purpose separation also prevents a stored digest from being used as a bearer token. */
export function bookingToken(secret: string, id: string, purpose: Purpose) {
  return createHmac('sha256', secret)
    .update(`venueflow:public-booking:v1:${purpose}:${id}`)
    .digest('base64url');
}

export function bookingTokenHash(token: string, purpose: Purpose) {
  return createHash('sha256').update(`${purpose}:${token}`).digest('hex');
}

export function matchesBookingToken(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
