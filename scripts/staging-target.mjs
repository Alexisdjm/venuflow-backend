import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stagingFile = resolve('.env.staging');

export function loadStagingEnv() {
  if (!existsSync(stagingFile)) {
    throw new Error('Missing .env.staging. Copy .env.staging.example and fill it locally.');
  }
  const env = {};
  for (const line of readFileSync(stagingFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, eq).trim()] = value;
  }
  return env;
}

export function assertSessionPooler(connectionString) {
  if (!connectionString || /PASTE_|YOUR_|PROJECT_REF|change_me/.test(connectionString)) {
    throw new Error('DATABASE_URL in .env.staging is still a placeholder.');
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL in .env.staging is not a valid URL.');
  }
  const host = url.hostname.toLowerCase();
  const port = url.port || '5432';
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const user = decodeURIComponent(url.username);
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost')
  ) {
    throw new Error('Refusing staging command: the host is local.');
  }
  if (
    port === '5433' ||
    database === 'venueflow' ||
    database === 'venueflow_test' ||
    user === 'venueflow' ||
    user === 'venueflow_test'
  ) {
    throw new Error('Refusing staging command: this URL points at the local or test database.');
  }
  if (!host.endsWith('.pooler.supabase.com')) {
    throw new Error(
      'Refusing staging command: use the Supabase session pooler host (*.pooler.supabase.com), not the direct or local host.',
    );
  }
  if (port !== '5432') {
    throw new Error(
      'Refusing staging command: session pooler uses port 5432. Port 6543 is the transaction pooler and cannot run Prisma migrations.',
    );
  }
  if (!/^(postgres|prisma)\.[a-z0-9]+$/i.test(user)) {
    throw new Error(
      'Refusing staging command: the session pooler user must look like postgres.PROJECT_REF.',
    );
  }
  if (url.searchParams.get('pgbouncer') === 'true') {
    throw new Error('Refusing staging command: pgbouncer=true belongs to the transaction pooler.');
  }
  const sslmode = url.searchParams.get('sslmode');
  if (!sslmode || !['require', 'verify-ca', 'verify-full'].includes(sslmode)) {
    throw new Error('Refusing staging command: add sslmode=require to the session pooler URL.');
  }
  if (url.searchParams.get('sslrootcert') && !existsSync(url.searchParams.get('sslrootcert'))) {
    throw new Error('Refusing staging command: sslrootcert does not point at a readable file.');
  }
  return {
    host,
    port,
    database,
    userKind: user.split('.')[0],
    sslmode,
    verifiesCertificate: sslmode !== 'require' || Boolean(url.searchParams.get('sslrootcert')),
  };
}

export function describeStaging() {
  const env = loadStagingEnv();
  const target = assertSessionPooler(env.DATABASE_URL);
  return { env, target };
}
