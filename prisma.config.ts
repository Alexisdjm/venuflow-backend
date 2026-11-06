import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
// Staging commands set DATABASE_URL before this file loads. dotenv does not override it.

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: env('DATABASE_URL') },
});
