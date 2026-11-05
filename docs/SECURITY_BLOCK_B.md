# Bloque B: consistencia transaccional

Continuacion: [SECURITY_BLOCK_C.md](./SECURITY_BLOCK_C.md) documenta los cambios
posteriores de reglas, comprobantes y pendientes adicionales de consistencia.

Intervencion del 2026-11-05. Continua el Bloque A. Solo backend; no modifica
frontends, subdominios, configuracion de produccion ni los bloques C/D.

## Hallazgos confirmados

- Confirmaciones leian la solicitud antes de reclamarla y podian competir por
  crear citas. La comprobacion de disponibilidad no bastaba para idempotencia.
- El cliente se creaba fuera de la transaccion de la cita, pudiendo quedar una
  ficha nueva tras un rechazo posterior de agenda.
- Cancelar/expirar una solicitud pendiente podia sobrescribir una confirmacion
  concurrente mediante una escritura basada en un estado leido anteriormente.
- La unicidad de administrador por spa existia solo como consulta previa.
- Tres relaciones secundarias no aseguraban tenant en PostgreSQL.
- El trigger de categoria por cliente/dia no se ejecutaba al cambiar solo status,
  permitiendo intentar reactivar una cita sin aplicar esa regla.
- Algunos errores esperados de constraints/concurrencia acababan como HTTP 500.

## Implementacion

### Confirmacion e identidad atomicas

`public-booking-requests.service.ts` ahora utiliza una unica transaccion para
reservas individuales y multiples. Primero bloquea la fila BookingRequest con
`SELECT ... FOR UPDATE`, siempre identificada por bearer valido y su spa.
Despues relee estado, pertenencia, vigencia y condiciones del Bloque A.

La creacion/reutilizacion de Customer forma parte de esa misma transaccion.
Un advisory lock transaccional por spa/cedula serializa las confirmaciones publicas
que intentan crear esa identidad. Si el cliente ya existe se bloquea su fila
antes de aplicar la politica de contacto de A; no se sobrescribe su ficha.
Se conservan el indice unico de identidad y los constraints de agenda.

Spa, servicios, profesional, asignacion y jornadas utilizados se protegen con
bloqueos compartidos mientras se confirma, volviendo a leer las condiciones
despues de obtenerlos. SchedulingService acepta opcionalmente el cliente de
transaccion; reutiliza el motor existente sin consultar otra conexion por fuera
de la transaccion. Los servicios se bloquean en orden estable.

El cliente, todas las citas y la solicitud confirmada se guardan o revierten juntos.
No se llama a Brevo dentro de la transaccion. La auditoria secundaria conserva
su comportamiento anterior; su resiliencia pertenece al Bloque D.

### Idempotencia: contrato explicito

`POST /public/booking-verifications/:token/confirm` conserva ruta y respuesta.

- `Idempotency-Key`: obligatorio, entre 1 y 128 caracteres ASCII visibles.
- Ambito de la clave: una solicitud, no todas las solicitudes del spa.
- Misma solicitud + misma clave: devuelve su comprobante sin crear citas nuevas.
- Misma solicitud + otra clave tras confirmar: 409, sin modificar la reserva.
- Solicitud cancelada/invalida: 409. Pendiente expirada: 410.
- Una confirmacion ya exitosa puede recuperarse con la misma clave incluso si
  vencio despues el token de verificacion. No autoriza una reserva nueva ni
  devuelve el comprobante con otra clave. La consulta normal de verificacion
  mantiene el vencimiento de A.
- Los reintentos reconstruyen el comprobante vigente; no son una copia inmutable
  del JSON original si hubo una modificacion administrativa posterior (Bloque C).

Integracion pendiente: BookingVerification genera hoy una clave nueva por click.
Debe conservarla durante los reintentos de la misma confirmacion. No se cambio
el frontend en esta intervencion. Reabrir detalles durante la vigencia permite
consultar una confirmacion existente, pero no sustituye esa integracion.

La cancelacion pendiente utiliza una actualizacion condicional de estado y
vigencia. Las actualizaciones de expiracion tambien comprueban el estado actual;
no pueden convertir una confirmacion concurrente en CANCELLED/EXPIRED.

### Errores

`common/database-conflict.ts` identifica codigos Prisma/PostgreSQL conocidos
(unicidad, FK, check, exclusion, conflictos de escritura, deadlock/bloqueo y
transaccion abortada) sin devolver mensajes SQL. El filtro HTTP los transforma
en 409 generico; confirmacion aplica el mismo mapeo para sus consumidores internos.
Errores de programacion/conectividad desconocidos no se disfrazan de conflicto.
No hay reintentos automaticos ilimitados: ante 409 transaccional el consumidor
puede repetir con la misma clave tras revisar el resultado.

La provision de administradora conserva su comprobacion previa y ahora tiene
un indice unico parcial en PostgreSQL. Si hay una carrera, solo una insercion
puede ganar; la otra devuelve 409 sin revelar detalles internos.

## Migracion

`20261106000000_public_booking_integrity_b/migration.sql`:

1. Preflight de relaciones cruzadas/huerfanas y administradores duplicados.
   Si detecta incompatibilidad, se detiene antes del DDL, sin corregir/borrar datos.
2. Indices compuestos de BookingRequest para referencias por id/spa.
3. FK compuestas para appointmentId, visitRequestId y professionalId.
4. Indice parcial unico de SPA_ADMIN por spa (incluye administradores suspendidos,
   como la regla previa del servicio).
5. Trigger de categoria actualizado para incluir cambios de status y spaId.

Se conservan las exclusiones de agenda, triggers y unicidades anteriores.
El DDL se ejecuta en una transaccion. Las comprobaciones previas no sustituyen
una ventana coordinada de migracion; los indices/FK pueden bloquear escrituras.
Se aplico exclusivamente al PostgreSQL temporal de localhost:5433/venueflow_test.
No se inspeccionaron ni alteraron datos reales de desarrollo/staging/produccion.

Importante: PostgreSQL 17 permite `ON DELETE SET NULL (appointmentId)` y
`ON DELETE SET NULL (visitRequestId)`. Solo anula el enlace opcional; nunca spaId.
Prisma no representa la lista de columnas de SET NULL y muestra dos advertencias
al validar/generar el esquema. No son errores; hay pruebas reales de ambas
eliminaciones. Conservar este SQL personalizado en futuras migraciones y no usar
`db push` ni regenerar esas FK como SET NULL de todas las columnas. El indice
parcial de administradores y los triggers tambien son SQL personalizado.

Antes de aplicar fuera de pruebas: backup, preflight autorizado, revision humana
de cualquier inconsistencia y validacion de la version PostgreSQL. No eliminar
administradores o asociaciones automaticamente para que el preflight pase.

## Archivos afectados

- `src/modules/public-booking/public-booking-requests.service.ts`: transaccion,
  locks, idempotencia, rollback de identidad y escrituras condicionales.
- `src/modules/scheduling/scheduling.service.ts`: cliente transaccional opcional.
- `src/common/database-conflict.ts` y su spec: clasificacion segura de errores.
- `src/common/filters/http-exception.filter.ts`: mapeo HTTP central.
- `src/modules/spas/spas.service.ts`: mensaje de conflicto de provision coherente.
- `prisma/schema.prisma` y migracion B: integridad relacional y unicidad.
- `test/integration/public-booking-a.integration-spec.ts`: conserva regresion A y
  agrega el grupo B; las asociaciones invalidas de la prueba A ahora se rechazan
  directamente en PostgreSQL, antes de llegar a la aplicacion.

## Pruebas

Se usan PostgreSQL 17 real y fixtures propios sobre la base temporal validada
por hostname/puerto/nombre. No se hacen envios reales de correo.

- Confirmaciones simultaneas con claves iguales/distintas, individuales y multiples.
- Reintento de respuesta perdida tras vencimiento, conservando la misma clave.
- Dos solicitudes por un mismo horario y rollback de la identidad perdedora.
- Rollback de todos los segmentos si un segmento posterior no esta disponible.
- Carrera confirmacion/cancelacion pendiente sin cita confirmada huerfana.
- Administradores simultaneos: exactamente uno y conflicto 409 para el otro.
- FK cruzadas rechazadas, SET NULL por columna y reactivacion por categoria.
- Preflight SQL real sobre tablas temporales de la sesion: relaciones cruzadas,
  administradores duplicados y caso limpio, sin mutar datos incompatibles.
- Clasificacion de errores y regresion administrativa, autenticacion y Bloque A.

Resultados finales ejecutados:

| Comando | Resultado |
| --- | --- |
| `node node_modules/prisma/build/index.js generate` | Cliente generado. |
| `node node_modules/prisma/build/index.js migrate deploy` | 19 migraciones aplicadas en base temporal vacia, incluida B. |
| `node node_modules/prisma/build/index.js validate` | Valido; dos advertencias SET NULL explicadas arriba. |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.build.json` | Sin errores. |
| `node node_modules/oxlint/bin/oxlint src/ test/` | Sin errores. |
| `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand` | 19 suites, 127 pruebas aprobadas. |
| `node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-integration.json --runInBand` | 2 suites, 58 pruebas aprobadas (26 A, 16 B, 16 regresiones administrativas). |
| `node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand` | 1 suite, 2 pruebas aprobadas. |
| `git diff --check` | Sin errores; avisos locales LF/CRLF. |

Integracion ejecutada con `NODE_ENV=test`, secreto de prueba y exclusivamente
`127.0.0.1:5433/venueflow_test`. La primera ejecucion detecto que Prisma no puede
deserializar el retorno void de advisory lock; se corrigio seleccionando una
constante desde esa funcion. Tambien se corrigio el test de vencimiento para
avanzar el reloj sin modificar el dato historico comparado. Tras las correcciones
se repitieron las suites. Permanecen los avisos de VM Modules y deprecacion de pg
ya observados en A; no causaron fallos. No se ejecutaron pruebas frontend ni
envios reales de Brevo. El contenedor temporal se detuvo al terminar.

## Pendientes y limites

- C: disponibilidad publicada, elegibilidad de catalogo, comprobantes vigentes,
  cancelaciones parciales y revision general de snapshots/precios historicos.
- D: cooldown atomico, rate limiting, proxies, Brevo y errores secundarios de
  auditoria/notificaciones. Un fallo de auditoria aun puede ocurrir despues del
  commit; repetir la misma clave recupera la reserva sin duplicarla.
- Se mantienen la transicion legacy y la necesidad de conservar la clave de
  tokens descritas en A. No se introduce hostname ni autorizacion por headers.
- No se afirma que todos los escritores administrativos usen el mismo orden de
  bloqueos. Un deadlock se revierte y se devuelve como conflicto, no se fuerza
  una confirmacion. Se conservan las protecciones PostgreSQL como ultima barrera.
- La migracion real y la integracion de clave estable del formulario quedan
  pendientes. No considerar la plataforma completa lista para produccion.
