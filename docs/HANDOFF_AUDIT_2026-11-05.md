# VenueFlow — auditoría de handoff (5 nov 2026)

Documento para continuar la planificación en otro chat. Describe el estado local
real. No autoriza producción ni un despliegue.

## 1. Producto y repositorios

SaaS multi-tenant para spas: profesionales, servicios, clientes y reservas.
Tres repositorios independientes bajo `venueflow/`:

- `venueflow-api`: NestJS 11, TypeScript, Prisma 7.10.1 (no migrar a Prisma 8),
  PostgreSQL 17, JWT/Passport, Argon2, Luxon, Brevo, Throttler 6.
- `venueflow-dashboard`: Next.js 16.4.2, React 19. Puerto local 3001.
- `VenueflowClientForm`: Next.js 16.4.3, React 19. Puerto local 3002.

El API local usa el puerto 3000 y el prefijo `/api/v1`. Desarrollo: Postgres
Docker en `localhost:5432`. Pruebas de integración: solo
`127.0.0.1:5433/venueflow_test`. Nunca correr esa suite contra desarrollo,
staging o producción.

Roles: `PLATFORM_ADMIN`, `SPA_ADMIN`, `PROFESSIONAL`. El aislamiento es `spaId`.
La cédula es la identidad del cliente dentro del spa (`@@unique(spaId, nationalId)`).
No se sobrescribe nombre, teléfono ni correo de una ficha ya existente.

Dominio previsto: `tryvenueflow.com`. Hoy no hay resolución por hostname,
subdominios wildcard, Traefik ni despliegue nuevo. Eso pertenece a una etapa
posterior. No implementar slugs automáticos ni dominios propios todavía.

## 2. Git

- API: último commit `02d4a8c` ("Implement cancellation logic for segmented
  appointments"). Encima hay unos 47 paths sin commit: bloques de seguridad A–D,
  forma de pago, migraciones `20261103`, `20261105` y `20261106`, y los docs de
  esta auditoría. No se ha hecho commit ni push de ese trabajo.
- Dashboard: árbol limpio. Último commit `01f781b`, que ya incluye el widget
  "Citas del día" en el resumen en lugar de acciones rápidas.
- El formulario público no formó parte de los bloques A–D.

## 3. Seguridad backend A–D (hecha, sin frontend)

Detalle en `docs/SECURITY_BLOCK_A.md`, `SECURITY_BLOCK_B.md`,
`SECURITY_BLOCK_C.md`, `SECURITY_BLOCK_D.md` y `DEPLOYMENT_READINESS.md`.

### A. Identidad, confirmación y tokens

- Una solicitud pública no crea ni vincula un Customer. Solo guarda lo enviado
  y manda el correo a esa dirección.
- Confirmar demuestra control de ese correo, no la titularidad oficial de la
  cédula. No existe verificación de identidad gubernamental.
- Si la cédula no existe en el spa, el Customer se crea al confirmar.
- Si existe, el correo (trim + minúsculas) y el nombre (NFKC, espacios,
  minúsculas) deben coincidir. Si no, 409 genérico: contactar al spa. No se
  devuelve la ficha ni se sobrescribe.
- La cita usa los datos enviados en la solicitud, no los privados de otra ficha.
- Spa suspendido, servicio inactivo, profesional inactivo o asignación inválida
  impiden confirmar. Consultar o cancelar una reserva ya hecha sigue posible
  con su token.
- Si cambian precio, duración, moneda o zona mientras la solicitud está
  pendiente, hay que solicitar de nuevo. No se actualiza el precio aceptado.
- Tokens nuevos: hash, propósitos separados (verificación, comprobante,
  reenvío). El UUID de la solicitud no autoriza el reenvío. Los paths de error
  redactan el token. Los comprobantes no caducan por el `expiresAt` de
  verificación. Tokens legacy `tokenVersion = 0` siguen leyéndose; no se
  invalidaron reservas viejas.

### B. Transacciones e integridad

- Confirmar bloquea la solicitud (`FOR UPDATE`) y crea cliente + citas en la
  misma transacción. Brevo no se llama dentro de esa transacción.
- `Idempotency-Key` obligatoria, 1–128 caracteres ASCII visibles, ámbito de una
  solicitud. Misma clave: devuelve el comprobante. Otra clave tras confirmar:
  409. Expirada: 410.
- Migración `20261106000000_public_booking_integrity_b`: preflight que aborta
  si hay datos cruzados, FK compuestas con `spaId` (appointmentId,
  visitRequestId, professionalId), índice único parcial de un `SPA_ADMIN` por
  spa, trigger de categoría que también mira cambios de status. PostgreSQL 17
  usa `ON DELETE SET NULL` solo de la columna opcional. Prisma avisa porque no
  modela esa lista. No regenerar esas FK con `db push`.
- Errores esperados de unicidad, exclusión, FK y deadlock pasan a 409 sin
  volcar SQL.

### C. Disponibilidad y comprobantes

- Elegibilidad pública: reservable solo si está activo, duración fija válida,
  precio fijo y hay profesional activa. Duración variable: `ESTIMATED`. Precio
  variable o sin profesional: `CONSULTATION_REQUIRED`. Campos aditivos:
  `onlineBookable`, `unavailableReason`, `unavailableMessage`.
- La disponibilidad pública no ofrece huecos pasados ni la tolerancia
  administrativa. Los inicios caen en la grilla local de 30 minutos. En una
  secuencia solo el inicio debe estar en esa grilla; el siguiente segmento
  puede empezar a `:15` o `:45` si la duración no es múltiplo de 30.
- No hay buffers, feriados ni descansos como entidad. Buffer cero: citas
  adyacentes son válidas. Un día sin jornada no publica horarios.
- El comprobante usa las citas vigentes y `Appointment.servicePrice`. No el
  precio actual del catálogo. Total = confirmadas + completadas. Canceladas no
  suman. Campos nuevos: `timezone`, `currency`, `partiallyCancelled`,
  `appointments` (id, nombres, inicio, fin, status, price). Cancelación total:
  el comprobante responde 404. Si hay un servicio completado, la cancelación
  pública responde 409 y no reescribe esa cita.
- Reprogramar con la misma profesional conserva `servicePrice` y
  `commissionRate`. Cambiar de profesional conserva el precio y toma la
  comisión de la nueva asignación.

### D. Abuso, Brevo y efectos secundarios

- Reenvío: un `updateMany` condicional. Dos peticiones simultáneas envían un
  solo correo. Si Brevo falla, se libera el cooldown para un reintento manual.
- Máximo 5 solicitudes por spa y correo cada 10 minutos. El 429 no dice si el
  correo ya era cliente.
- Límites HTTP por proceso, usando la IP de la conexión, no
  `X-Forwarded-For`: lecturas públicas 60/min, secuencia 20/min, escrituras
  públicas 10/min, resto 100/min. `GET /api/v1/health` no entra al límite.
- `TRUST_PROXY` está en false. Ponerlo en `true` o `1` solo cuando Traefik sea
  el único salto y reescriba ese header. Si se enciende antes, un cliente puede
  falsificar la IP.
- Brevo: un intento, timeout 10 s, sin reintento automático y sin cola.
- Si la auditoría o un correo posterior fallan, la cita ya confirmada o
  cancelada igual responde éxito. El primer correo de una solicitud nueva sigue
  siendo obligatorio: si no sale, la solicitud se borra porque el cliente aún
  no tiene el enlace.

## 4. Forma de pago (producto, no del bloque de seguridad)

Enum `PaymentMethod`: `PAGO_MOVIL`, `PUNTO_DE_VENTA`, `ZELLE`, `BINANCE`.
Migración `20261103000000_appointment_payment_method`. Obligatoria al crear
cita individual o secuencia desde el dashboard. Nullable para reservas
públicas antiguas o sin ese dato. El dashboard ya pide el campo y lo muestra
en la lista del día. Esa migración sí se aplicó en su momento a la base local
de desarrollo (`localhost:5432`). Las migraciones A/B de reservas públicas se
aplicaron en la base de pruebas del puerto 5433, no se verificó que 5432 las
tenga.

## 5. Dashboard (UI ya hecha, aparte de la seguridad)

- Confirmación de cita individual en dos columnas: datos a la izquierda,
  resumen a la derecha. Cliente nuevo abre el modal. Cliente recurrente busca
  y lista resultados debajo. Los dos botones siguen visibles para alternar.
- `TabHeading` en `components/UXUI` unifica el encabezado. `action` muestra
  botones; `date` muestra la fecha del resumen; si no hay ninguno, solo el
  título.
- El resumen reemplazó acciones rápidas por las citas confirmadas de hoy. Si
  no hay, usa el empty state "No hay citas disponibles".

El dashboard no consume todavía `onlineBookable`, las razones de elegibilidad
ni el desglose nuevo del comprobante. Esos campos son del formulario público.

## 6. Contratos que el formulario público aún no integra

No se modificó `VenueflowClientForm` en A–D. Al planificar esa integración:

- Conservar la misma `Idempotency-Key` en los reintentos de
  `POST /public/booking-verifications/:token/confirm`. Hoy el cliente genera
  una clave nueva por click.
- Leer `onlineBookable`, `unavailableReason` y `unavailableMessage`. No tratar
  un precio variable como reserva instantánea.
- Mostrar `timezone`, `currency`, `appointments` y `partiallyCancelled`.
- El `requestId` de creación es `uuid.capacidadDeReenvio`, no un UUID solo.
- Un 409 de identidad no incluye datos del cliente existente. No hay que
  inventar una pantalla que los muestre.

## 7. Pruebas ejecutadas el 5 nov 2026

Contra Postgres 17 de pruebas, con Brevo sustituido por un espía:

- Bloque C, antes de D: integración 81 pruebas aprobadas. Unitarias de agenda,
  política, disponibilidad y citas: 40 aprobadas. No se repitió ese día la
  suite unitaria completa (en una pasada anterior de C fueron 134).
- Bloque D: 30 unitarias (after-commit, auditoría, correo, citas) y la
  integración completa, 84 pruebas, aprobadas.
- No se ejecutaron de nuevo las e2e ni `oxlint` en la pasada de D.
- No se probaron los frontends ni un envío real de Brevo.

## 8. Qué no hacer en la siguiente etapa de planificación

- No reescribir la arquitectura ni cambiar JWT.
- No pasar a Prisma 8 ni a Supabase Auth.
- No usar `prisma db push`.
- No borrar migraciones ni datos para que un preflight pase.
- No activar `TRUST_PROXY` sin la topología real de Traefik.
- No añadir Redis, BullMQ ni un outbox salvo que se decida explícitamente la
  entrega durable de correo.
- No implementar hostname, wildcard ni Jenkins en el mismo cambio que la
  integración del formulario.
- No commitear `.env`, `.env.staging` ni claves.

## 9. Orden sugerido para seguir

1. Decidir si el trabajo A–D del API se commitea y se revisa antes de tocar
   infraestructura.
2. `migrate status` en la base que se vaya a usar. Backup antes de
   `migrate deploy`. La migración B aborta sola si hay filas cruzadas.
3. Integrar el formulario público a los contratos de la sección 6.
4. Recién después: hostname, proxy, secretos de producción y Brevo real.
   `TRUST_PROXY` sigue en false hasta validar ese proxy.

## 10. Veredicto

El backend local cubre los hallazgos de seguridad de reservas que se
planificaron en los bloques A–D, con pruebas de integración en una base
temporal. No está desplegado, no está commiteado y no debe tratarse como listo
para producción. La planificación de infraestructura puede continuar, pero el
formulario público y la configuración de proxy siguen pendientes y no están
cubiertos por esas pruebas.
