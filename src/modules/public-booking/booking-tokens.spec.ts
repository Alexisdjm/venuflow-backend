import {
  bookingToken,
  bookingTokenHash,
  matchesBookingToken,
} from './booking-tokens';

describe('booking bearer credentials', () => {
  const secret = 'test-only-secret-with-more-than-32-characters';
  it('separates verification, receipt and resend purposes', () => {
    const tokens = ['verification', 'receipt', 'resend'].map((purpose) =>
      bookingToken(
        secret,
        'request-a',
        purpose as 'verification' | 'receipt' | 'resend',
      ),
    );
    expect(new Set(tokens).size).toBe(3);
    expect(tokens.every((token) => /^[A-Za-z0-9_-]{43}$/.test(token))).toBe(
      true,
    );
    expect(bookingToken(secret, 'request-b', 'verification')).not.toBe(
      tokens[0],
    );
  });
  it('stores purpose-specific digests rather than usable bearer credentials', () => {
    const token = bookingToken(secret, 'request-a', 'verification');
    expect(bookingTokenHash(token, 'verification')).not.toBe(token);
    expect(bookingTokenHash(token, 'verification')).not.toBe(
      bookingTokenHash(token, 'receipt'),
    );
    expect(matchesBookingToken(token, token)).toBe(true);
    expect(matchesBookingToken(token, `${token}x`)).toBe(false);
    expect(
      matchesBookingToken(
        token,
        token.replace(/^./, token[0] === 'A' ? 'B' : 'A'),
      ),
    ).toBe(false);
  });
});
