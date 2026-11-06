/** Keep aligned with src/database/prisma/pg-pool-config.ts */
export function prismaPgConfig(connectionString) {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get('sslmode');
  const rootCertificate = url.searchParams.get('sslrootcert');
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
