/** Pool settings for node-pg 8. Prisma CLI uses libpq and is unchanged. */
export function prismaPgConfig(connectionString: string): {
  connectionString: string;
  ssl?: { rejectUnauthorized: false };
} {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get('sslmode');
  const rootCertificate = url.searchParams.get('sslrootcert');
  // pg 8 treats sslmode=require as verify-full. libpq only encrypts.
  if (sslmode === 'require' && !rootCertificate) {
    url.searchParams.delete('sslmode');
    url.searchParams.delete('uselibpqcompat');
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: false },
    };
  }
  return { connectionString };
}
