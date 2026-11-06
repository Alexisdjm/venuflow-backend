import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeStaging } from './staging-target.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const commands = {
  target: null,
  status: ['node_modules/prisma/build/index.js', 'migrate', 'status'],
  deploy: ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  seed: ['node_modules/prisma/build/index.js', 'db', 'seed'],
  start: ['node_modules/@nestjs/cli/bin/nest.js', 'start'],
  admin: ['scripts/check-staging-admin.mjs'],
};

const appEnvKeys = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'PUBLIC_BOOKING_TOKEN_SECRET',
  'JWT_ACCESS_EXPIRES_IN',
  'REFRESH_TOKEN_EXPIRES_DAYS',
  'SWAGGER_ENABLED',
  'TRUST_PROXY',
  'CORS_ORIGINS',
  'BREVO_API_KEY',
  'BREVO_SENDER_EMAIL',
  'BREVO_SENDER_NAME',
  'PUBLIC_BOOKING_BASE_URL',
  'PUBLIC_BOOKING_ROOT_DOMAIN',
  'PUBLIC_BOOKING_PROTOCOL',
  'PUBLIC_BOOKING_PORT',
  'PLATFORM_ADMIN_EMAIL',
  'PLATFORM_ADMIN_PASSWORD',
  'PLATFORM_ADMIN_FIRST_NAME',
  'PLATFORM_ADMIN_LAST_NAME',
  'VENUEFLOW_ENV_FILE',
  'VENUEFLOW_RUNTIME',
];

export function commandArgs(action) {
  const spec = commands[action];
  if (!spec) return null;
  const [script, ...cliArgs] = spec;
  // Only the Node entrypoint is a filesystem path. Prisma and Nest tokens
  // such as "migrate" or "start" must stay literal; path.resolve would turn
  // them into "<cwd>\migrate" on Windows.
  return [resolve(root, script), ...cliArgs];
}

export function stagingChildEnv(fileEnv, runtime) {
  const env = { ...process.env };
  for (const key of appEnvKeys) delete env[key];
  Object.assign(env, fileEnv);
  env.VENUEFLOW_ENV_FILE = '.env.staging';
  env.DATABASE_URL = fileEnv.DATABASE_URL;
  if (runtime) env.VENUEFLOW_RUNTIME = runtime;
  return env;
}

function envFileValue(fileName, key) {
  const path = resolve(root, fileName);
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1 || trimmed.slice(0, eq).trim() !== key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

function assertStartConfig(fileEnv) {
  const jwt = fileEnv.JWT_ACCESS_SECRET ?? '';
  if (jwt.length < 32 || /replace_with|change_me|PASTE_|YOUR_/.test(jwt)) {
    throw new Error(
      'JWT_ACCESS_SECRET in .env.staging must be a staging-only secret of at least 32 characters.',
    );
  }
  if (jwt === envFileValue('.env', 'JWT_ACCESS_SECRET')) {
    throw new Error('Refusing staging start: JWT_ACCESS_SECRET matches the local .env secret.');
  }
  const bookingSecret = fileEnv.PUBLIC_BOOKING_TOKEN_SECRET ?? '';
  if (bookingSecret && bookingSecret.length < 32) {
    throw new Error(
      'PUBLIC_BOOKING_TOKEN_SECRET in .env.staging must be empty or at least 32 characters.',
    );
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  const action = process.argv[2];
  if (!Object.hasOwn(commands, action)) {
    console.error('Usage: node scripts/staging-guard.mjs target|status|deploy|seed|start|admin');
    process.exit(1);
  }

  let staging;
  try {
    staging = describeStaging();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid staging target.');
    process.exit(1);
  }

  const { host, port, database, userKind, sslmode } = staging.target;
  console.log(
    `Staging target: ${userKind}.…@${host}:${port}/${database} sslmode=${sslmode}`,
  );
  if (action === 'start') {
    try {
      assertStartConfig(staging.env);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Invalid staging configuration.');
      process.exit(1);
    }
  }
  if (action !== 'target') {
    const childEnv = stagingChildEnv(staging.env, action === 'start' ? 'staging' : undefined);
    const child = spawn(process.execPath, commandArgs(action), {
      cwd: root,
      env: childEnv,
      shell: false,
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      process.exit(code ?? 1);
    });
  }
}
