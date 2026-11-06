import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeStaging } from './staging-target.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const commands = {
  target: null,
  status: ['node_modules/prisma/build/index.js', 'migrate', 'status'],
  deploy: ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  seed: ['node_modules/prisma/build/index.js', 'db', 'seed'],
  start: ['dist/main.js'],
  admin: ['scripts/check-staging-admin.mjs'],
};

export function commandArgs(action) {
  const spec = commands[action];
  if (!spec) return null;
  const [script, ...cliArgs] = spec;
  // Only the Node entrypoint is a filesystem path. Prisma tokens such as
  // "migrate" must stay literal; path.resolve would turn them into
  // "<cwd>\migrate" and Prisma reports that path as an unknown command.
  return [resolve(root, script), ...cliArgs];
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
  if (action !== 'target') {
    const childEnv = { ...process.env, ...staging.env, VENUEFLOW_ENV_FILE: '.env.staging' };
    childEnv.DATABASE_URL = staging.env.DATABASE_URL;
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
