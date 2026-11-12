import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeProduction } from './production-target.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const commands = {
  target: null,
  status: ['node_modules/prisma/build/index.js', 'migrate', 'status'],
  deploy: ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  seed: ['node_modules/prisma/build/index.js', 'db', 'seed'],
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
  'VENUEFLOW_ENV',
  'VENUEFLOW_RUNTIME',
];

export function commandArgs(action) {
  const spec = commands[action];
  if (!spec) return null;
  const [script, ...cliArgs] = spec;
  return [resolve(root, script), ...cliArgs];
}

export function productionChildEnv(fileEnv) {
  const env = { ...process.env };
  for (const key of appEnvKeys) delete env[key];
  Object.assign(env, fileEnv);
  env.VENUEFLOW_ENV_FILE = '.env.production';
  env.VENUEFLOW_ENV = 'production';
  env.DATABASE_URL = fileEnv.DATABASE_URL;
  return env;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  const action = process.argv[2];
  if (!Object.hasOwn(commands, action)) {
    console.error('Usage: node scripts/production-guard.mjs target|status|deploy|seed');
    process.exit(1);
  }
  if (
    (action === 'deploy' || action === 'seed') &&
    process.argv[3] !== 'confirm-production'
  ) {
    const label = action === 'seed' ? 'seed' : 'migrate';
    console.error(
      `Refusing production ${label}. Re-run: npm run production:${label} -- confirm-production`,
    );
    process.exit(1);
  }

  let production;
  try {
    production = describeProduction();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid production target.');
    process.exit(1);
  }

  const { host, port, database, userKind, projectRef, sslmode } = production.target;
  console.log(
    `Production target: ${userKind}.${projectRef}@${host}:${port}/${database} sslmode=${sslmode}`,
  );
  if (action === 'deploy') {
    console.log('Confirmed production migrate deploy.');
  }
  if (action === 'seed') {
    const password = production.env.PLATFORM_ADMIN_PASSWORD ?? '';
    if (
      !production.env.PLATFORM_ADMIN_EMAIL?.trim() ||
      password.length < 12 ||
      !production.env.PLATFORM_ADMIN_FIRST_NAME?.trim() ||
      !production.env.PLATFORM_ADMIN_LAST_NAME?.trim()
    ) {
      console.error(
        'Set PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD (12+), PLATFORM_ADMIN_FIRST_NAME and PLATFORM_ADMIN_LAST_NAME in .env.production',
      );
      process.exit(1);
    }
    console.log('Confirmed production seed. Creates the platform administrator only.');
  }
  if (action !== 'target') {
    const child = spawn(process.execPath, commandArgs(action), {
      cwd: root,
      env: productionChildEnv(production.env),
      shell: false,
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      process.exit(code ?? 1);
    });
  }
}
