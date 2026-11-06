const hostname =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const publicSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedSlugs = new Set(['app', 'api', 'www', 'admin']);

export type BookingUrlSettings = {
  protocol: 'http' | 'https';
  rootDomain: string;
  port: string;
};

export function isPublicSpaSlug(slug: string) {
  return publicSlug.test(slug) && !reservedSlugs.has(slug);
}

/** Domain, protocol and port come only from configuration. */
export function readBookingUrlConfig(
  get: (key: string) => string | undefined,
): BookingUrlSettings {
  const base = parseBase(get('PUBLIC_BOOKING_BASE_URL'));
  const configuredRoot = asHostname(get('PUBLIC_BOOKING_ROOT_DOMAIN'));
  const rootDomain = configuredRoot ?? asHostname(base?.hostname) ?? 'localhost';
  const configuredProtocol = asProtocol(get('PUBLIC_BOOKING_PROTOCOL'));
  const protocol =
    configuredProtocol ??
    (configuredRoot ? 'https' : (asProtocol(base?.protocol) ?? 'http'));
  const configuredPort = asPort(get('PUBLIC_BOOKING_PORT'));
  const port = configuredPort ?? (configuredRoot ? '' : (base?.port ?? ''));
  return { protocol, rootDomain, port };
}

export function publicSpaOrigin(settings: BookingUrlSettings, slug: string) {
  if (!isPublicSpaSlug(slug) || !asHostname(settings.rootDomain)) {
    throw new Error('Invalid public booking origin');
  }
  const port = settings.port ? `:${settings.port}` : '';
  return `${settings.protocol}://${slug}.${settings.rootDomain}${port}`;
}

export function publicSpaUrl(
  settings: BookingUrlSettings,
  slug: string,
  path: string,
) {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('://') ||
    path.includes('\\')
  ) {
    throw new Error('Invalid public booking path');
  }
  return `${publicSpaOrigin(settings, slug)}${path}`;
}

function parseBase(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function asHostname(value: string | undefined) {
  const host = value?.trim().toLowerCase().replace(/\.$/, '');
  if (
    !host ||
    host.includes('://') ||
    host.includes('/') ||
    host.includes(':') ||
    host.includes('*')
  )
    return undefined;
  return hostname.test(host) ? host : undefined;
}

function asProtocol(value: string | undefined): 'http' | 'https' | undefined {
  const protocol = value?.trim().toLowerCase().replace(':', '');
  return protocol === 'http' || protocol === 'https' ? protocol : undefined;
}

function asPort(value: string | undefined) {
  const port = value?.trim();
  if (port === undefined || port === '') return undefined;
  if (!/^\d{1,5}$/.test(port)) return undefined;
  const number = Number(port);
  if (number === 0 || number > 65535) return undefined;
  return port;
}
