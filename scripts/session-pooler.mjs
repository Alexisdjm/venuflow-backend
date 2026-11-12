import { existsSync } from 'node:fs';

export function assertSessionPooler(connectionString, fileLabel) {
  if (!connectionString || /PASTE_|YOUR_|PROJECT_REF|change_me|REPLACE_WITH/.test(connectionString)) {
    throw new Error(`DATABASE_URL in ${fileLabel} is still a placeholder.`);
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`DATABASE_URL in ${fileLabel} is not a valid URL.`);
  }
  const host = url.hostname.toLowerCase();
  const port = url.port || '5432';
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const user = decodeURIComponent(url.username);
  const projectRef = user.split('.')[1]?.toLowerCase() ?? '';
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost')
  ) {
    throw new Error(`Refusing ${fileLabel}: the host is local.`);
  }
  if (
    port === '5433' ||
    database === 'venueflow' ||
    database === 'venueflow_test' ||
    user === 'venueflow' ||
    user === 'venueflow_test'
  ) {
    throw new Error(`Refusing ${fileLabel}: this URL points at the local or test database.`);
  }
  if (!host.endsWith('.pooler.supabase.com')) {
    throw new Error(
      `Refusing ${fileLabel}: use the Supabase session pooler host (*.pooler.supabase.com), not the direct or local host.`,
    );
  }
  if (port !== '5432') {
    throw new Error(
      `Refusing ${fileLabel}: session pooler uses port 5432. Port 6543 is the transaction pooler and cannot run Prisma migrations.`,
    );
  }
  if (!/^(postgres|prisma)\.[a-z0-9]+$/i.test(user)) {
    throw new Error(
      `Refusing ${fileLabel}: the session pooler user must look like postgres.PROJECT_REF.`,
    );
  }
  if (url.searchParams.get('pgbouncer') === 'true') {
    throw new Error(`Refusing ${fileLabel}: pgbouncer=true belongs to the transaction pooler.`);
  }
  const sslmode = url.searchParams.get('sslmode');
  if (!sslmode || !['require', 'verify-ca', 'verify-full'].includes(sslmode)) {
    throw new Error(`Refusing ${fileLabel}: add sslmode=require to the session pooler URL.`);
  }
  if (url.searchParams.get('sslrootcert') && !existsSync(url.searchParams.get('sslrootcert'))) {
    throw new Error(`Refusing ${fileLabel}: sslrootcert does not point at a readable file.`);
  }
  return {
    host,
    port,
    database,
    userKind: user.split('.')[0],
    projectRef,
    sslmode,
    verifiesCertificate: sslmode !== 'require' || Boolean(url.searchParams.get('sslrootcert')),
  };
}
