# Bloque A: seguridad de reservas publicas

Actualizacion posterior: las correcciones y pruebas del Bloque B se documentan en
[SECURITY_BLOCK_B.md](./SECURITY_BLOCK_B.md). Este informe conserva el estado y
los resultados historicos de la intervencion A.

Fecha: 2026-11-05. Alcance: identidad, validaciones de confirmacion,
aislamiento de operaciones publicas y credenciales. No implementa B, C ni D.
No incorpora hostname, slugs automaticos, activacion online ni despliegues.

## Hallazgos verificados

- `customerFor()` asociaba clientes por cedula antes de verificar correo y
  reutilizaba sus datos privados en correo/cita. Corregido en este bloque.
- La confirmacion no rechazaba uniformemente spas/servicios desactivados ni
  cambios de precio/duracion. Se valida de nuevo antes de escribir.
- Profesionales, jornadas y asignaciones ya se consultaban por spa; se conserva
  ese motor y se hace explicito el spa en la asignacion de servicios.
- Las FK principales ya impiden cruces de tenant. Las relaciones secundarias
  solicitud/cita/visita no tienen la misma garantia. Se rechazan asociaciones
  incoherentes en la aplicacion; el refuerzo de FK pertenece al Bloque B.
- Tokens en claro, reenvio con UUID y credenciales en `path` de errores eran
  problemas presentes. Nuevas solicitudes usan hashes y capacidad de reenvio.

## Politica de identidad de invitados

1. Crear solicitud guarda solo los datos aportados y envia el correo a esa
   direccion. No consulta, crea, vincula ni actualiza un Customer.
2. El token presentado al confirmar demuestra control del correo de la solicitud.
3. Si la cedula no existe dentro del spa, se crea Customer al confirmar.
4. Si existe, se exige que el correo previamente registrado coincida (trim y
   minusculas) y que coincida el nombre (NFKC, espacios y minusculas).
5. Sin correo registrado o ante contradicciones, se rechaza con 409 generico:
   contactar al spa. Nunca se devuelve el registro encontrado ni se sobrescribe.
6. La cita usa nombre/telefono/cedula aportados; no copia datos privados de la
   ficha. La ficha existente permanece intacta, incluso si cambia el telefono.
7. La unicidad `(spaId, nationalId)` permanece. Si dos confirmaciones crean al
   mismo cliente, el perdedor de la insercion vuelve a leer y aplica la misma
   politica, sin crear duplicados ni aceptar un correo contradictorio.

Limites: esto verifica un contacto previamente registrado, NO la identidad
oficial ni la titularidad de una cedula. Se confia en la calidad del contacto
historico del spa. Registros antiguos contaminados por el flujo vulnerable
requieren revision administrativa: no se certifican ni se borran automaticamente.
Un invitado nuevo puede declarar una cedula que no le corresponde; no existe un
proveedor de identidad oficial. No hay enumeracion previa a verificar correo;
el rechazo generico posterior no garantiza impedir toda inferencia indirecta.
Los limites por destinatario/spa y la deteccion de abuso quedan para D.

## Confirmacion y snapshots minimos

- Spa activo, token pendiente/vigente, pertenencia de relaciones y condiciones
  del servicio se comprueban antes de confirmar. Se releen solicitud y spa dentro
  de la transaccion y se vuelven a aplicar las validaciones.
- Cada solicitud nueva, individual o multiple, guarda segmentos con precio,
  categoria, duracion e intervalo ofrecidos. No se cambia el contrato HTTP.
- Si cambian precio, tipo de precio, duracion, tipo de duracion o categoria,
  se exige solicitar de nuevo. Nunca se acepta silenciosamente el nuevo precio.
- Se conservan comprobaciones de asignacion, profesional activo, jornadas,
  disponibilidad y exclusion PostgreSQL. No se reescribe disponibilidad.
- Una solicitud individual antigua sin snapshot no permite demostrar el precio
  ofrecido: devuelve 409 y requiere nueva solicitud. Las reservas YA confirmadas
  no se invalidan. Alternativa descartada: confirmar con el precio actual sin
  prueba de lo ofrecido, que incumpliria el requisito de precio aceptado.
- Consultar comprobante y cancelar siguen disponibles para spas suspendidos.

Esto no implementa bloqueo de filas ni reclamacion atomica de confirmaciones.
Las carreras con cambios administrativos posteriores a la lectura requieren B.
Tampoco implementa la revision general de comprobantes/precios historicos de C.

## Tokens y compatibilidad

Las filas nuevas usan `tokenVersion=1`. El bearer se deriva mediante HMAC-SHA256
de una clave secreta, UUID aleatorio de solicitud, version y proposito. El valor
persistido en `token`/`receiptToken` es SHA256 con separacion de proposito.
Un hash de la BD no funciona como bearer; verificacion, comprobante y reenvio
no son intercambiables. El bearer solo se reconstruye dentro del servidor para
correo/reintentos. La capacidad de reenvio se compara en tiempo constante.

Configurar `PUBLIC_BOOKING_TOKEN_SECRET` (minimo 32 caracteres aleatorios) antes
de emitir credenciales v1 y conservarlo durante su vigencia. Para compatibilidad
local, si falta, se usa `JWT_ACCESS_SECRET`. No cambiar de fallback a clave
dedicada ni rotar esa clave sin una estrategia de llavero/versiones: afectaria
la reconstruccion de enlaces y capacidades anteriores. La rotacion segura de
claves requiere trabajo adicional; no se implementa silenciosamente.

- Verificacion: 15 minutos para solicitudes nuevas. Tras confirmar, la pantalla
  actual puede recuperar el comprobante con ese enlace solo durante su vigencia.
  Esta transicion conserva la pantalla actual, pero no ofrece acceso permanente
  al comprobante mediante el token de verificacion v1.
- Comprobante: separado, sin caducidad arbitraria mientras la reserva sea valida.
  Cancelar revoca su consulta; repetir cancelacion sigue siendo idempotente.
- Reenvio: `requestId` de creacion ahora es una cadena opaca `uuid.capacidad`.
  El frontend actual la transporta sin interpretarla y no necesita cambios.
  UUID solo, token de verificacion y token de comprobante no autorizan reenvio.
- Filas antiguas: `tokenVersion=0`, tokens y comprobantes existentes siguen
  leyendose en su formato anterior; no se destruyen ni se convierten sin acceso
  al bearer original. El acceso historico por enlace confirmado se conserva.
- UUID antiguo no autoriza reenvio. Se puede iniciar una solicitud nueva. La
  alternativa de aceptar UUID indefinidamente conservaria la vulnerabilidad.
- Correos de cambios administrativos v1 enlazan al comprobante; nunca al digest
  almacenado ni a una verificacion que ya expiro.
- El filtro de excepciones oculta tokens/capacidades y query strings en `path`.
  La configuracion de access logs del proxy y su redaccion sigue pendiente.

Integracion frontend posterior: al confirmar, guardar/navegar al enlace
`/booking/confirmation?token=<receiptToken>`. Sin ello, reabrir el correo inicial
despues de 15 minutos ya no recupera comprobantes v1. El contrato devuelve el
token necesario; no se modificaron los frontends. Si se requiere reabrir siempre
desde el mismo correo, sera necesario un correo de comprobante o un mecanismo
explicito de recuperacion, en lugar de prolongar la verificacion indefinidamente.

## Migracion y despliegue posterior

`20261105000000_public_booking_security_a`:

- Agrega `tokenVersion INTEGER NOT NULL DEFAULT 0`.
- Permite `BookingRequest.customerId=NULL` durante la espera de verificacion.
- Conserva datos, indices unicos, FK, triggers y exclusion de solapamientos.
- No refuerza relaciones con nuevas FK compuestas sin revisar primero datos.

Aplicar migracion antes del nuevo servidor. La aplicacion antigua no debe operar
sobre solicitudes nuevas con cliente nulo; no es una migracion para despliegue
mixto sin coordinacion. No revertir a NOT NULL mientras existan solicitudes nuevas
sin cliente. No se ejecuto contra desarrollo, staging ni produccion.

Preflight de solo lectura para futuras FK (ejecutar en un entorno autorizado):

```sql
SELECT br.id FROM "BookingRequest" br JOIN "Appointment" a ON a.id=br."appointmentId"
WHERE br."spaId" <> a."spaId";
SELECT a.id FROM "Appointment" a JOIN "BookingRequest" br ON br.id=a."visitRequestId"
WHERE a."spaId" <> br."spaId";
SELECT br.id FROM "BookingRequest" br JOIN "Professional" p ON p.id=br."professionalId"
WHERE br."spaId" <> p."spaId";
```

No hay hostname esperado en el contrato actual: el slug resuelve un catalogo
publico y el bearer autoriza la solicitud identificada. Cuando exista contexto
de hostname confiable, comparar su spa con `request.spaId` en todos los metodos.
No se introducen headers de tenant ni UUID arbitrarios como autorizacion.

## Dependencias pendientes (no implementadas)

| Bloque | Trabajo pendiente |
| --- | --- |
| B | Bloqueo/reclamacion de solicitud, confirmaciones simultaneas, conflictos de categoria, mapeo HTTP de errores, FK compuestas y concurrencia de administradores. |
| C | Disponibilidad publica vs tolerancias, elegibilidad del catalogo, comprobantes vigentes, cancelacion parcial, zona horaria/moneda y snapshots historicos generales. |
| D | Cooldown atomico, limites por operacion/spa/correo, proxies confiables, timeout Brevo, reintentos, auditoria y fallos secundarios. |

El cooldown previo de 60 segundos se conserva: NO se afirma que sea atomico.
Proteger su credencial corresponde a A; su concurrencia y limitacion corresponden
a D. Una creacion verificada puede dejar un Customer sin cita si luego falla la
agenda: no equivale a una reserva confirmada. Su atomicidad completa pertenece a B.

## Pruebas

`test/integration/public-booking-a.integration-spec.ts` usa PostgreSQL real y
rechaza cualquier URL distinta de localhost:5433/venueflow_test. Crea fixtures
propios y elimina solo esos fixtures. Brevo se sustituye por un espia; no envia
correos reales. Incluye identidad, concurrencia de creacion de cliente, estados,
condiciones de servicio, asignaciones, tokens, transicion legacy y relaciones
cruzadas que la FK secundaria actual permite.

Resultados ejecutados sobre el estado final:

| Comando | Resultado |
| --- | --- |
| `node node_modules/prisma/build/index.js generate` | Cliente generado correctamente. |
| `node node_modules/prisma/build/index.js migrate deploy` | 18 migraciones aplicadas en PostgreSQL temporal vacio, incluida A. |
| `node node_modules/prisma/build/index.js validate` | Esquema valido. |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.build.json` | Sin errores. |
| `node node_modules/oxlint/bin/oxlint src/ test/` | Sin errores. |
| `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand` | 18 suites, 113 pruebas aprobadas. |
| `node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-integration.json --runInBand` | 2 suites, 42 pruebas aprobadas: 26 de A y 16 regresiones. |
| `node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand` | 1 suite, 2 pruebas aprobadas. |

La integracion se ejecuto con `NODE_ENV=test`, secreto de prueba y `DATABASE_URL`
apuntando exclusivamente a `127.0.0.1:5433/venueflow_test`. No se creo `.env.test`
ni se reutilizaron credenciales de desarrollo/staging/produccion.

La primera ejecucion detecto una expectativa previa desactualizada en la prueba
administrativa de reservas multiples: el servicio actual devuelve
`{ appointments, customerStatus }`, no un array. Se ajustaron solo esas
aserciones al contrato existente; no se cambio el servicio ni sus consumidores.
La prueba legacy nueva tambien requirio corregir un fixture que intentaba
solicitar el horario que acababa de confirmar. Ambas suites se repitieron y pasan.

Node advierte del uso experimental de VM Modules y `pg` emite una deprecacion
por consultas concurrentes en un cliente; no produjeron fallos. La revision de
concurrencia general sigue en B. No se ejecutaron envios reales de Brevo,
pruebas frontend ni pruebas de infraestructura de produccion.

No considerar el flujo listo para produccion sin resolver B/C/D y revisar las
consecuencias de compatibilidad y de conservacion de claves descritas arriba.
