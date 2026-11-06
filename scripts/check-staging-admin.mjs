import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { prismaPgConfig } from './pg-pool-config.mjs';
import { describeStaging } from './staging-target.mjs';

const { env } = describeStaging();
const prisma = new PrismaClient({
  adapter: new PrismaPg(prismaPgConfig(env.DATABASE_URL)),
});

try {
  const users = await prisma.user.findMany({
    where: { role: 'PLATFORM_ADMIN' },
    select: { email: true, status: true, spaId: true },
  });
  const configuredEmail = (env.PLATFORM_ADMIN_EMAIL ?? '')
    .trim()
    .toLowerCase();

  console.log(`PLATFORM_ADMIN_COUNT=${users.length}`);
  console.log(
    `ACTIVE_PLATFORM_ADMIN_COUNT=${users.filter((user) => user.status === 'ACTIVE' && user.spaId === null).length}`,
  );
  console.log(`SEED_EMAIL_CONFIGURED=${configuredEmail ? 'true' : 'false'}`);
  console.log(
    `SEED_EMAIL_MATCHES_EXISTING=${
      configuredEmail
        ? users.some((user) => user.email === configuredEmail)
        : 'not_configured'
    }`,
  );
} finally {
  await prisma.$disconnect();
}
