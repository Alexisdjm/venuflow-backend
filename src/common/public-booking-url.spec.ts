import {
  isPublicSpaSlug,
  publicSpaUrl,
  readBookingUrlConfig,
} from './public-booking-url';

describe('public booking urls', () => {
  const dev = {
    PUBLIC_BOOKING_ROOT_DOMAIN: 'localhost',
    PUBLIC_BOOKING_PROTOCOL: 'http',
    PUBLIC_BOOKING_PORT: '3002',
  };
  const production = { PUBLIC_BOOKING_ROOT_DOMAIN: 'tryvenueflow.com' };

  function read(env: Record<string, string | undefined>) {
    return readBookingUrlConfig((key) => env[key]);
  }

  it('builds a local subdomain from configuration', () => {
    expect(
      publicSpaUrl(read(dev), 'emi-nails', '/booking/verify?token=abc'),
    ).toBe('http://emi-nails.localhost:3002/booking/verify?token=abc');
  });

  it('builds the production origin from the configured root domain', () => {
    expect(
      publicSpaUrl(
        read(production),
        'bella-nails',
        '/booking/confirmation?token=abc',
      ),
    ).toBe(
      'https://bella-nails.tryvenueflow.com/booking/confirmation?token=abc',
    );
  });

  it('derives the local host from the legacy base url', () => {
    expect(
      publicSpaUrl(
        read({ PUBLIC_BOOKING_BASE_URL: 'http://localhost:3002' }),
        'emi-nails',
        '/booking/verify?token=abc',
      ),
    ).toBe('http://emi-nails.localhost:3002/booking/verify?token=abc');
  });

  it('rejects reserved slugs, foreign domains and unsafe paths', () => {
    for (const slug of ['app', 'api', 'www', 'admin', 'Emi Nails', 'spa.evil.com']) {
      expect(isPublicSpaSlug(slug)).toBe(false);
      expect(() =>
        publicSpaUrl(read(production), slug, '/booking/verify?token=abc'),
      ).toThrow('Invalid public booking origin');
    }
    expect(() =>
      publicSpaUrl(
        read(production),
        'emi-nails',
        'https://evil.example/booking/verify',
      ),
    ).toThrow('Invalid public booking path');
    expect(
      read({ PUBLIC_BOOKING_ROOT_DOMAIN: 'https://evil.example' }).rootDomain,
    ).toBe('localhost');
  });
});
