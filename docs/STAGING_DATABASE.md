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
entorno ya traiga la base local, y rechazan localhost, el puerto 5433 y las
bases `venueflow` y `venueflow_test`.

```text
npm run staging:target
npm run staging:check
```

`staging:target` no abre una conexión. Imprime usuario resumido, host, puerto,
base y `sslmode`. `staging:check` ejecuta `prisma migrate status` contra ese
destino y no aplica migraciones.

`staging:migrate` es `migrate deploy`. No forma parte de la comprobación.
`staging:start` arranca el build con `VENUEFLOW_ENV_FILE=.env.staging`, así
Nest no rellena variables que falten desde `.env`.
