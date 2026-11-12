# Base de producción en Supabase

Solo `venueflow-api`. No cambia `.env`, `.env.staging`, el Postgres local ni
los contenedores que ya están publicados. `.env.production` está ignorado por
`.env.*`. El ejemplo commiteable es `.env.production.example`.

La referencia del proyecto de producción se escribe en
`scripts/supabase-projects.mjs` (`PRODUCTION_PROJECT_REF`). Hasta que esa
referencia sea la del proyecto nuevo, `production:target` se niega a correr.
No copies el usuario, el host ni la contraseña de staging.

## Comandos

```text
npm run production:target
npm run production:check
npm run production:migrate -- confirm-production
npm run production:seed -- confirm-production
```

`production:target` no abre una conexión. Imprime el tipo de usuario, la
referencia del proyecto, el host, el puerto, la base y `sslmode`.

`production:check` ejecuta solo `prisma migrate status`.

`production:migrate` sin el argumento `confirm-production` no hace nada.
Con ese argumento ejecuta solo `prisma migrate deploy`. Nest no migra al iniciar.

`production:seed` crea el administrador de plataforma a partir de
`PLATFORM_ADMIN_*` en `.env.production`. La contraseña debe tener al menos 12
caracteres. Si ese correo ya es platform admin, no cambia la contraseña.

## Corte de Jenkins

El script `scripts/jenkins-deploy.sh` ya no trae el proyecto de Supabase
escrito. El contenedor, el router y los dominios siguen iguales. El job actual
no cambia hasta que alguien copie este script en Jenkins.

Antes de ese reemplazo, crea estas credenciales y enlázalas al job con los
valores del proyecto que el contenedor usa hoy. Cuando se autorice el corte,
se cambian los valores por los de producción y se vuelve a ejecutar el mismo
job. No hace falta otro job.

| Credencial | Runtime | Notas |
|---|---|---|
| `SUPABASE_USER` | `docker run` | `postgres.<ref>` del session pooler, puerto 5432 |
| `SUPABASE_HOST` | `docker run` | host `*.pooler.supabase.com` |
| `SUPABASE_DB_PASSWORD` | `docker run` | contraseña de Database, sin codificar; el script la codifica |
| `JWT_ACCESS_SECRET` | `docker run` | 32 caracteres o más, distinto por entorno |
| `PUBLIC_BOOKING_TOKEN_SECRET` | `docker run` | obligatorio si `VENUEFLOW_ENV=production`; distinto del JWT |
| `VENUEFLOW_ENV` | `docker run` | déjalo vacío hasta el corte; luego `production` |
| `BREVO_API_KEY` | `docker run` | clave `xkeysib-` de Brevo |
| `BREVO_SENDER_EMAIL` | `docker run` | remitente verificado en Brevo |

`NODE_ENV=production` del contenedor no significa el entorno de producción.
Eso lo marca `VENUEFLOW_ENV=production`. Sin esa variable, los enlaces públicos
pueden seguir firmándose con el JWT, como hasta ahora.
