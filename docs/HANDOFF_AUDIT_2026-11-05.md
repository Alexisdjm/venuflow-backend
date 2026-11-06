# VenueFlow — auditoría de handoff (5 nov 2026)

Documento para continuar la planificación en otro chat. Describe el estado local
real al cierre del 5 nov 2026, después de integrar el formulario y alinear las
bases. No autoriza producción ni un despliegue. Si un párrafo de más abajo
contradice esta cabecera, manda la cabecera y las secciones 2, 6, 9 y 10.

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

Dominio previsto: `tryvenueflow.com`. El slug del spa ya existe y es único;
el administrador lo escribe al crear el spa. No se genera solo desde el
nombre y no hay dominios propios. La URL pública
`https://{slug}.tryvenueflow.com` todavía no existe: no hay DNS comodín,
certificado TLS, Traefik ni resolución por hostname. Esa es la siguiente
etapa. Jenkins despliega las apps; no crea esa URL.

## 2. Git

Los tres árboles estaban limpios y en `main`, alineados con `origin/main`,
antes de editar este documento. Este archivo queda modificado al actualizarlo.

- API: `48f5a8b` ("Add environment configuration and deployment documentation").
  Incluye los bloques A–D, la forma de pago y las migraciones `20261103`,
  `20261105` y `20261106`. El commit anterior de producto es `02d4a8c`.
- Dashboard: `01f781b`. Incluye "Citas del día" en el resumen. No consume
  elegibilidad pública ni el desglose nuevo del comprobante.
- Formulario: `884539d`. Integra los contratos de la sección 6. El commit
  anterior es `ee108ca`.

## 3. Seguridad backend A–D (hecha; el formulario ya la consume)

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
en la lista del día.

El 5 nov 2026 por la noche, `prisma migrate status` mostró 19 migraciones en
las dos bases locales. `venueflow_test` en `127.0.0.1:5433` ya estaba al día.
`venueflow` en `127.0.0.1:5432` no tenía A ni B. Se guardó una copia en
`%TEMP%\venueflow-dev-20261105.dump` y `prisma migrate deploy` aplicó
`20261105000000_public_booking_security_a` y
`20261106000000_public_booking_integrity_b`. El preflight de B pasó. Un
`migrate status` posterior dijo que el esquema de desarrollo está al día.
No se usó `db push` ni `migrate dev`. Esto no dice nada de staging ni de
producción: allí hay que repetir status, backup y `migrate deploy`.

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

## 6. Formulario público: contratos ya integrados

`VenueflowClientForm` en `884539d` ya consume el API actual. No volver a
planificar esa integración. Detalles que el código real impuso:

- `Idempotency-Key` estable por enlace de verificación, en `sessionStorage`
  bajo un alias. El token no se guarda. Un fallo de red reintenta la misma
  clave. Si el servidor responde que ya se confirmó con otra clave, se vuelve
  a leer el enlace y se muestra el comprobante.
- `onlineBookable`, `unavailableReason` y `unavailableMessage`. Un servicio no
  elegible se ve y no se puede seleccionar. Los motivos reales son `INACTIVE`,
  `VARIABLE_DURATION`, `INVALID_DURATION`, `VARIABLE_PRICE` y
  `NO_ACTIVE_PROFESSIONAL`.
- Comprobante con `timezone`, `currency`, `partiallyCancelled` y
  `appointments[]`. Cada cita usa `start` y `end`, no `startAt` ni `endAt`.
  El total es el del backend. Las fechas visibles usan la zona del spa. El
  `.ics` sigue en UTC.
- El `requestId` de creación es `uuid.capacidadDeReenvio`. El reenvío manda
  esa cadena completa y codificada. No se muestra ni se persiste. En
  verificación y comprobante, `requestId` vuelve a ser solo el UUID.
- Un 409 «en línea / Contacta al spa» se muestra como un mensaje genérico,
  sin datos de otro cliente. Un 409 de horario conserva su propio mensaje.
- El modo demo reproduce esos contratos. `NEXT_PUBLIC_SPA_SLUG` sigue en
  `src/app/page.tsx`. No quitarlo hasta la resolución por hostname.
- ESLint del formulario falla por un `setState` dentro del efecto de carga
  (`react-hooks/set-state-in-effect` en `BookingForm.tsx`). Es anterior a
  esta integración. Jest: 4 suites, 17 pruebas, aprobadas. `next build`
  generó las 7 rutas. No hay suite de integración en el formulario. Se
  recorrió el catálogo real de `emi-nails` en `localhost:3002` sin enviar
  la solicitud.

## 7. Pruebas ejecutadas el 5 nov 2026

Contra Postgres 17 de pruebas, con Brevo sustituido por un espía:

- Bloque C, antes de D: integración 81 pruebas aprobadas. Unitarias de agenda,
  política, disponibilidad y citas: 40 aprobadas. No se repitió ese día la
  suite unitaria completa (en una pasada anterior de C fueron 134).
- Bloque D: 30 unitarias (after-commit, auditoría, correo, citas) y la
  integración completa, 84 pruebas, aprobadas.
- No se ejecutaron de nuevo las e2e ni `oxlint` en la pasada de D.
- No se probó un envío real de Brevo.
- Formulario, después de la integración: Jest 17/17. Build de Next 16.4.3
  correcto. ESLint con el error previo descrito en la sección 6.

## 8. Qué no hacer en la siguiente etapa de planificación

- No reescribir la arquitectura ni cambiar JWT.
- No pasar a Prisma 8 ni a Supabase Auth.
- No usar `prisma db push`.
- No borrar migraciones ni datos para que un preflight pase.
- No añadir Redis, BullMQ ni un outbox salvo que se decida explícitamente la
  entrega durable de correo.
- No mezclar en un mismo cambio el DNS, Traefik, el certificado, Jenkins y
  la lectura del host en el formulario.
- No generar el slug automáticamente ni implementar dominios propios del spa.
- No activar `TRUST_PROXY` hasta que Traefik sea el único salto y reescriba
  `X-Forwarded-For`.
- No commitear `.env`, `.env.staging` ni claves.
- No tratar el certificado TLS comodín como una licencia de software. Es un
  certificado para `*.tryvenueflow.com`. Let's Encrypt solo lo emite con un
  reto DNS.

## 9. Orden sugerido para seguir

Hecho en local: API A–D commiteado, formulario integrado y commiteado, bases
`5432` y `5433` al día. No repetir esos pasos.

Siguiente objetivo: al crear un spa, su slug es el host del formulario,
`https://{slug}.tryvenueflow.com`. El slug ya se guarda. Falta la dirección.

1. DNS: `*.tryvenueflow.com` al servidor, más los nombres fijos (`api`, el
   dashboard y `www`). Reservar esos nombres para que no se lean como spas.
2. Certificado TLS que cubra `*.tryvenueflow.com`. No es una licencia.
3. Traefik: un solo formulario recibe el host original. `TRUST_PROXY` sigue
   en false hasta comprobar que Traefik reescribe `X-Forwarded-For`.
4. Formulario: leer el `Host`, extraer el subdominio y usarlo como
   `spaSlug`. Recién ahí quitar `NEXT_PUBLIC_SPA_SLUG`.
5. API: el enlace de verificación debe usar el host de ese spa. Hoy
   `PUBLIC_BOOKING_BASE_URL` es un solo origen
   (`/booking/verify?token=`). `CORS_ORIGINS` es una lista fija; tiene que
   aceptar el patrón del formulario, no un origen nuevo por spa.
6. Dashboard: mostrar la URL pública al crear el spa. Hoy solo se ve
   `/{slug}`.
7. Jenkins al final, cuando DNS, certificado y Traefik ya existan. No hay
   Jenkinsfile en estos repositorios. Los jobs despliegan API, dashboard y
   formulario; no inventan el subdominio.
8. Secretos de producción y Brevo real van con ese despliegue, fuera de git.
   En staging o producción: backup, `migrate status` y `migrate deploy`.
   No asumir que esas bases están como las locales.

Dominios propios de cada spa (`reservas.eminails.com`) quedan fuera de esta
etapa.

## 10. Veredicto

El backend local cubre los hallazgos de seguridad de reservas A–D. El
formulario público ya habla con esos contratos. Las bases locales de
desarrollo y de pruebas tienen las 19 migraciones. Nada de eso está
desplegado ni debe tratarse como listo para producción. La planificación
puede seguir por la URL `https://{slug}.tryvenueflow.com`, en el orden de la
sección 9. El proxy, el certificado y Jenkins siguen pendientes.
