import { loadEnvFile } from './env-file.mjs';
import { assertSessionPooler as assertPooler } from './session-pooler.mjs';
import {
  isConfiguredProjectRef,
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
} from './supabase-projects.mjs';

const fileLabel = '.env.staging';

export function loadStagingEnv() {
  return loadEnvFile(fileLabel);
}

export function assertSessionPooler(connectionString) {
  const target = assertSessionPoolerBase(connectionString);
  if (
    isConfiguredProjectRef(PRODUCTION_PROJECT_REF) &&
    STAGING_PROJECT_REF === PRODUCTION_PROJECT_REF
  ) {
    throw new Error('Refusing staging command: staging and production project refs are the same.');
  }
  if (target.projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error('Refusing staging command: DATABASE_URL is the production Supabase project.');
  }
  if (target.projectRef !== STAGING_PROJECT_REF) {
    throw new Error('Refusing staging command: DATABASE_URL is not the staging Supabase project.');
  }
  return target;
}

function assertSessionPoolerBase(connectionString) {
  return assertPooler(connectionString, fileLabel);
}

export function describeStaging() {
  const env = loadStagingEnv();
  const target = assertSessionPooler(env.DATABASE_URL);
  return { env, target };
}
