# VenueFlow API

Monolito modular multi-tenant para spas. Incluye JWT y refresh tokens rotatorios, roles, auditoría, profesionales, catálogo de servicios, horarios semanales y consulta de disponibilidad. Stack: Node.js 22+, NestJS 11, TypeScript estricto, Prisma 7 y PostgreSQL 17.

## Inicio local

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d postgres
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

API: `http://localhost:3000/api/v1`; Swagger: `http://localhost:3000/docs`; healthcheck: `GET /api/v1/health`.

`DATABASE_URL` contiene la conexión PostgreSQL. `JWT_ACCESS_SECRET` debe ser aleatorio y tener al menos 32 caracteres. `CORS_ORIGINS` acepta orígenes separados por coma. Las fechas se almacenan en UTC y `Spa.timezone` conserva la zona IANA para interpretar horarios locales. Nunca confirme archivos `.env`.

## Migraciones y staging

```powershell
npm run prisma:migrate -- --name nombre_cambio # solo desarrollo local
npm run prisma:generate
npm run prisma:deploy                           # staging/producción
npm run staging:check
npm run staging:migrate
npm run staging:start
```

Las migraciones versionadas son `20261019000000_initial` y `20261020000000_phase_2_foundation`. No use `db push` como reemplazo de migraciones.

## Administrador inicial

El seed es explícito e idempotente y no existe un bootstrap público:

```powershell
$env:PLATFORM_ADMIN_EMAIL='owner@example.com'
$env:PLATFORM_ADMIN_PASSWORD='una-clave-larga-y-unica'
$env:PLATFORM_ADMIN_FIRST_NAME='Platform'
$env:PLATFORM_ADMIN_LAST_NAME='Owner'
npm run prisma:seed
```

Con el token `PLATFORM_ADMIN`, cree spas en `POST /platform/spas` y su administrador inicial en `POST /platform/spas/{spaId}/admin`.

## Autenticación

`POST /auth/login` entrega un access token corto y un refresh token opaco. Solo se almacena SHA-256 del refresh token. `POST /auth/refresh` lo rota; reutilizar un token consumido revoca toda la familia. `POST /auth/logout` revoca la familia.

El dashboard debe mantener el access token en memoria. En web, el refresh token debe migrarse a cookie `HttpOnly; Secure`; use `SameSite=None` cuando API y dashboard estén en sitios diferentes, junto con validación de origen/CSRF. La respuesta JSON actual facilita Swagger y clientes no web.

## Servicios, horarios y disponibilidad

- `/api/v1/spa/services`: catálogo administrado por `SPA_ADMIN`.
- `PUT /api/v1/spa/services/{serviceId}/professionals/{professionalId}`: asigna un servicio.
- `/api/v1/spa/professionals/{professionalId}/schedules`: intervalos semanales.
- `/api/v1/me/services` y `/api/v1/me/schedules`: configuración propia del profesional.
- `GET /api/v1/spa/availability?date=2026-10-20&serviceId={uuid}`: slots en UTC y hora local.

Los días usan `0=domingo` a `6=sábado`; las horas son locales al timezone del spa. La disponibilidad actual considera asignación, horario y duración. Todavía no descuenta reservas, descansos ni excepciones.

## Auditoría

Las creaciones y modificaciones administrativas generan `AuditLog`. `SPA_ADMIN` consulta exclusivamente su tenant en `/spa/audit-logs`; `PLATFORM_ADMIN` consulta `/platform/audit-logs`. No se registran contraseñas ni tokens.

## Pruebas

```powershell
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Integración PostgreSQL real en el puerto local 5433:

```powershell
npm run test:db:up
npm run test:integration:prepare
npm run test:integration
npm run test:db:stop
```

`postgres-test` usa `tmpfs` y no conserva datos. La suite crea dos tenants y verifica aislamiento HTTP, restricciones cruzadas en PostgreSQL y rotación/reutilización de refresh tokens.

## Arquitectura

```text
src/
├── common/
├── config/
├── database/prisma/
└── modules/
    ├── audit/
    ├── auth/
    ├── availability/
    ├── health/
    ├── professionals/
    ├── schedules/
    ├── services/
    ├── spas/
    └── users/
prisma/
├── migrations/
├── schema.prisma
└── seed.ts
```

El tenant proviene del usuario autenticado, nunca del frontend. Consultas privadas y mutaciones filtran por `spaId`; claves foráneas compuestas impiden asociaciones cruzadas incluso ante un error de aplicación.

## Docker y despliegue

```powershell
docker build -t venueflow-api:latest .
```

En Jenkins: instalar, generar Prisma, probar, construir una imagen una sola vez, ejecutar `prisma migrate deploy` como tarea controlada y promocionar exactamente la imagen validada en staging. No ejecute migraciones concurrentemente en cada réplica.

Fuera de alcance actual: reservas, excepciones de horario, bloqueos, pagos, cálculo de comisiones, reportes, emails y frontend.
