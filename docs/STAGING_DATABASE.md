# Base de staging en Supabase

Solo `venueflow-api`. No cambia `.env`, el Postgres local ni el de pruebas.
`.env.staging` está ignorado por `.env.*` en `.gitignore`. El ejemplo
commiteable es `.env.staging.example`.

## Qué conexión usar

Nest es un proceso largo. En Supabase elige **Session pooler** (puerto 5432,
usuario `postgres.PROJECT_REF`, host `*.pooler.supabase.com`). Esa sesión
acepta prepared statements y el lock que usa Prisma Migrate, así que sirve
para el runtime (`@prisma/adapter-pg` 7.10.1) y para `migrate status` /
`migrate deploy`.

No hace falta un segundo `DIRECT_URL`. El pooler de transacción (puerto 6543,
`pgbouncer=true`) no entra en estos comandos: Prisma Migrate puede fallar ahí
con prepared statements. La conexión directa `db.PROJECT_REF.supabase.co`
tampoco: en redes solo IPv4 a menudo no resuelve, y el guardián la rechaza
para no mezclar destinos.

## TLS

Añade `sslmode=require` a la URI. Prisma CLI habla con libpq: ese modo cifra
y no verifica la CA.

El runtime usa `pg` 8.23. Esa versión trata `sslmode=require` como
`verify-full` y puede rechazar el certificado de Supabase.
`src/database/prisma/pg-pool-config.ts` convierte solo ese caso a cifrado sin
verificar CA, que es el significado de `require` en libpq. La URL local, sin
`sslmode`, no cambia.

Para verificar la CA, descarga el certificado raíz en Database settings de
Supabase y usa `sslmode=verify-full&sslrootcert=` con una ruta local fuera de
git. El guardián exige que ese archivo exista.

## Comandos

Todos leen únicamente `.env.staging`, sustituyen `DATABASE_URL` aunque el
entorno ya traiga la base local, y rechazan localhost, el puerto 5433, las
bases `venueflow` y `venueflow_test`, y cualquier proyecto Supabase que no sea
el de staging.

```text
npm run staging:target
npm run staging:check
```

`staging:target` no abre una conexión. Imprime usuario resumido, host, puerto,
base y `sslmode`. `staging:check` ejecuta `prisma migrate status` contra ese
destino y no aplica migraciones.

`staging:migrate` es `migrate deploy`. No forma parte de la comprobación.

`staging:start` compila e inicia Nest en esta máquina contra `.env.staging`.
El proceso marca `VENUEFLOW_RUNTIME=staging` y, al escuchar, escribe una línea
`STAGING` con host, puerto, base y `sslmode`. No imprime usuario ni contraseña.
Las variables de la aplicación se toman solo de `.env.staging`; un `DATABASE_URL`
o un JWT que ya estén en la terminal no entran. `.env` y el Postgres de Docker
siguen siendo el destino de `npm run start:dev`. Si ambos usan el puerto 3000,
detén el proceso local antes de arrancar staging.
