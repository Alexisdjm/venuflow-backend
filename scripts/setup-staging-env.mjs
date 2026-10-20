import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve('.env.staging');
const placeholder = 'PASTE_SUPABASE_SESSION_POOLER_URI_HERE';

if (existsSync(target)) {
  const current = readFileSync(target, 'utf8');
  if (!current.includes(placeholder)) {
    console.error('.env.staging already contains a DATABASE_URL. No changes were made.');
    process.exit(1);
  }
}

const jwtSecret = randomBytes(48).toString('hex');
const contents = `NODE_ENV=development
PORT=3000

# Paste the complete Supabase Session pooler URI after the equals sign.
DATABASE_URL=${placeholder}

# Generated locally. Do not reuse this value in production.
JWT_ACCESS_SECRET=${jwtSecret}
JWT_ACCESS_EXPIRES_IN=15m

SWAGGER_ENABLED=true
CORS_ORIGINS=http://localhost:3001
`;

writeFileSync(target, contents, { encoding: 'utf8', mode: 0o600 });
console.log('Created .env.staging with a new JWT secret.');
console.log('Next: replace the DATABASE_URL placeholder locally, then run npm run staging:check.');
