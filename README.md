# VenueFlow API

Monolito modular para la primera fase de VenueFlow: autenticación JWT, roles, spas y profesionales con aislamiento multi-tenant. Stack: Node.js 22+, NestJS 11, TypeScript estricto, Prisma 7 y PostgreSQL 17.

## Inicio local

```bash
npm install
copy .env.example .env
# Cambie POSTGRES_PASSWORD, DATABASE_URL y JWT_ACCESS_SECRET
docker compose up -d postgres
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

API: `http://localhost:3000/api/v1`; Swagger (solo fuera de producción y si está habilitado): `http://localhost:3000/docs`; healthcheck: `GET /api/v1/health`.

`DATABASE_URL` contiene la URL PostgreSQL. `JWT_ACCESS_SECRET` debe ser aleatorio y tener al menos 32 caracteres. `CORS_ORIGINS` acepta orígenes separados por coma. Las fechas se almacenan como instantes UTC; `Spa.timezone` conserva la zona IANA usada para interpretar horarios locales futuros. Nunca confirme `.env`.

## Primer administrador y aprovisionamiento

El seed es explícito e idempotente, no se ejecuta al iniciar y no existe endpoint público de bootstrap:

```powershell
$env:PLATFORM_ADMIN_EMAIL='owner@example.com'
$env:PLATFORM_ADMIN_PASSWORD='una-clave-larga-y-unica'
$env:PLATFORM_ADMIN_FIRST_NAME='Platform'
$env:PLATFORM_ADMIN_LAST_NAME='Owner'
npm run prisma:seed
```

Inicie sesión en `POST /api/v1/auth/login`. Con su Bearer token cree el spa en `POST /api/v1/platform/spas` y su único administrador inicial en `POST /api/v1/platform/spas/{spaId}/admin`. No se puede asignar `role` ni `spaId` desde esos DTOs.

## Migraciones, calidad y pruebas

```bash
npm run prisma:migrate -- --name nombre_cambio  # desarrollo
npm run prisma:deploy                           # despliegue
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
docker build -t venueflow-api:latest .
```

La migración inicial está en `prisma/migrations/20261019000000_initial`. Las pruebas unitarias cubren login, roles y filtros de tenant. Las e2e sin PostgreSQL cubren acceso no autenticado y validación; para integración real, ejecute PostgreSQL, migre y pruebe dos spas mediante Swagger.

## Arquitectura y seguridad

```text
src/
├── common/          # decoradores, guards, filtro y DTOs compartidos
├── config/          # validación del entorno
├── database/prisma/ # cliente inyectable
├── generated/prisma/# cliente generado (no editar)
└── modules/
    ├── auth/
    ├── health/
    ├── professionals/
    ├── spas/
    └── users/
prisma/              # schema, seed y migraciones
```

El JWT identifica `sub`, rol y tenant, pero cada solicitud vuelve a comprobar usuario y spa activos en base de datos. Los controladores privados nunca aceptan `spaId`: lo toman de la identidad validada. Lecturas y escrituras profesionales filtran por claves compuestas `id + spaId`; una FK compuesta también impide relacionar un profesional con un usuario de otro spa. Los secretos (`passwordHash`) se excluyen con `select` y el login usa un mensaje uniforme para evitar enumeración. Helmet, CORS explícito, whitelist estricta, rate limit y Argon2 están activos.

Los access tokens duran 15 minutos por defecto. Esta fase no implementa refresh tokens; un dashboard futuro debería usar access token en memoria y refresh token rotatorio en cookie `HttpOnly; Secure; SameSite=None` si API y dashboard usan sitios diferentes, acompañado de protección CSRF/origin.

## Despliegue

El Dockerfile multietapa compila y ejecuta como usuario sin privilegios. En Jenkins: construir/testear, crear la imagen, ejecutar `npm run prisma:deploy` como tarea única con las variables del gestor de secretos y después reemplazar el contenedor. No ejecute migraciones concurrentes en cada réplica. PostgreSQL de Compose solo se publica en loopback y es para desarrollo.

Fuera de alcance: reservas, servicios, agenda, pagos, cálculo de comisiones, reportes, emails y frontend.
