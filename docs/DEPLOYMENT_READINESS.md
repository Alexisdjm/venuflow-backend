# Estado para configurar el despliegue

Auditoria del 5 nov 2026. No es una autorizacion para produccion. No se
desplego nada y no se aplicaron migraciones fuera de la base de pruebas
`127.0.0.1:5433/venueflow_test`.

## Que ya cubre el backend

Bloques A–D, solo en `venueflow-api`, sin cambios de frontend:

- Identidad publica: la cedula no reutiliza ni revela la ficha de otro correo.
- Confirmacion: spa activo, servicio y profesional vigentes, snapshots, token
  con proposito y vencimiento, una sola confirmacion por solicitud.
- Aislamiento por `spaId` y relaciones compuestas de las migraciones A/B.
- Comprobantes con precio historico de la cita.
- Reenvios con cooldown atomico, cupo por correo y limites HTTP por proceso.
- Brevo con timeout y sin reintento automatico. Auditoria y correos posteriores
  no convierten una escritura ya confirmada en error 500.

Pruebas de esta pasada: unitarias del bloque D, 30 aprobadas; integracion
PostgreSQL, 84 aprobadas. La suite unitaria completa del repositorio no se
volvio a ejecutar en esta pasada.

## Migraciones

Hay 19 migraciones versionadas, incluidas forma de pago, seguridad publica A e
integridad B. D no agrega otra. En el destino usar `prisma migrate deploy`.
No usar `db push`. Antes de apuntar a un entorno real, revisar
`migrate status`: la base de desarrollo en el puerto 5432 no tiene por que
estar al dia con la base de pruebas.

## Configuracion que falta decidir

Dejar `TRUST_PROXY=false` hasta que Traefik sea el unico salto y reescriba
`X-Forwarded-For`. Si se enciende antes, un cliente puede falsificar su IP y
eludir el limite en memoria.

Variables minimas del API, sin commitear secretos:

- `NODE_ENV=production`
- `DATABASE_URL` del Postgres de ese entorno
- `JWT_ACCESS_SECRET` distinto del de desarrollo, 32 caracteres o mas
- `PUBLIC_BOOKING_TOKEN_SECRET` propio, para no firmar enlaces con el JWT
- `CORS_ORIGINS` solo con los origenes reales del dashboard y del formulario
- `PUBLIC_BOOKING_BASE_URL` con el origen publico del formulario
- `SWAGGER_ENABLED=false`
- `TRUST_PROXY=false` hasta validar el proxy
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` y `BREVO_SENDER_NAME` de la cuenta unica
  de VenueFlow

Salud: `GET /api/v1/health` no entra al limite de trafico y exige la base.

## No esta listo

- Resolucion por hostname, subdominios y dominios propios.
- Varias replicas: el throttler no es compartido. El cupo de 5 solicitudes por
  correo y spa si sobrevive entre procesos.
- Entrega durable de correo. Si Brevo falla despues de confirmar, la cita queda
  y el correo puede no salir. No hay cola.
- Frontends: deben conservar `Idempotency-Key` en reintentos, mostrar
  `onlineBookable` / `unavailableReason` y el comprobante con `appointments`,
  `currency`, `timezone` y `partiallyCancelled`. Esos contratos ya salen del API;
  las interfaces no se actualizaron.
- Rotacion de tokens legacy (`tokenVersion` 0) descrita en A/B.
- Esta auditoria no reviso Jenkins, Traefik ni el proyecto de Supabase. No
  afirma que las vulnerabilidades de infraestructura esten cerradas.
