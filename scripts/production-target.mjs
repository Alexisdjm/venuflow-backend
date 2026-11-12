import { envFileValue, loadEnvFile } from './env-file.mjs';
import { assertSessionPooler } from './session-pooler.mjs';
import {
  isConfiguredProjectRef,
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
} from './supabase-projects.mjs';

const fileLabel = '.env.production';

export function loadProductionEnv() {
  return loadEnvFile(fileLabel);
}

export function assertProductionPooler(connectionString) {
  if (!isConfiguredProjectRef(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      'Set PRODUCTION_PROJECT_REF in scripts/supabase-projects.mjs to the new Supabase project ref before using production commands.',
    );
  }
  if (PRODUCTION_PROJECT_REF === STAGING_PROJECT_REF) {
    throw new Error('Refusing production command: production and staging project refs are the same.');
  }
  const target = assertSessionPooler(connectionString, fileLabel);
  if (target.projectRef === STAGING_PROJECT_REF) {
    throw new Error('Refusing production command: DATABASE_URL is the staging Supabase project.');
  }
  if (target.projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error('Refusing production command: DATABASE_URL is not the production Supabase project.');
  }
  return target;
}

export function assertProductionSecrets(env) {
  const jwt = env.JWT_ACCESS_SECRET ?? '';
  if (jwt.length < 32 || /replace_with|change_me|PASTE_|YOUR_|REPLACE_WITH/.test(jwt)) {
    throw new Error('JWT_ACCESS_SECRET in .env.production must be a production-only secret of at least 32 characters.');
  }
  if (jwt === envFileValue('.env', 'JWT_ACCESS_SECRET')) {
    throw new Error('Refusing production command: JWT_ACCESS_SECRET matches the local .env secret.');
  }
  if (jwt === envFileValue('.env.staging', 'JWT_ACCESS_SECRET')) {
    throw new Error('Refusing production command: JWT_ACCESS_SECRET matches the staging secret.');
  }
  const booking = env.PUBLIC_BOOKING_TOKEN_SECRET ?? '';
  if (booking.length < 32 || /replace_with|change_me|PASTE_|YOUR_|REPLACE_WITH/.test(booking)) {
    throw new Error(
      'PUBLIC_BOOKING_TOKEN_SECRET in .env.production must be its own secret of at least 32 characters.',
    );
  }
  if (booking === jwt) {
    throw new Error('Refusing production command: PUBLIC_BOOKING_TOKEN_SECRET matches JWT_ACCESS_SECRET.');
  }
  if (
    booking === envFileValue('.env.staging', 'PUBLIC_BOOKING_TOKEN_SECRET') ||
    booking === envFileValue('.env.staging', 'JWT_ACCESS_SECRET') ||
    booking === envFileValue('.env', 'JWT_ACCESS_SECRET')
  ) {
    throw new Error('Refusing production command: PUBLIC_BOOKING_TOKEN_SECRET is reused from another environment.');
  }
}

export function describeProduction() {
  const env = loadProductionEnv();
  const target = assertProductionPooler(env.DATABASE_URL);
  assertProductionSecrets(env);
  return { env, target };
}
