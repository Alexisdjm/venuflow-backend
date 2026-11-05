# Bloque C: reglas publicas y comprobantes

Continua A/B, solo backend. Conserva los cambios locales previos. No modifica
frontends ni ejecuta migraciones sobre desarrollo, staging o produccion.

## Hallazgos y correcciones

### Elegibilidad

El catalogo anunciaba INSTANT para servicios de precio variable que luego eran
rechazados al solicitar. Tampoco distinguia servicios sin profesional activa.
`publicServiceEligibility()` centraliza la politica estructural:

- Automatica: servicio activo, duracion fija positiva, precio fijo y profesional
  activa asignada. La existencia de jornadas/horarios se consulta por separado.
- Duracion variable: ESTIMATED; no se convierte en confirmacion automatica.
- Precio variable o sin profesional: CONSULTATION_REQUIRED.
- Catalogo conserva los servicios variables visibles, pero no seleccionables
  automaticamente por el formulario actual (que ya comprueba mode).
- Los servicios desactivados siguen fuera del catalogo.
- Campos aditivos: onlineBookable, unavailableReason, unavailableMessage.
  Razones: INACTIVE, VARIABLE_DURATION, INVALID_DURATION, VARIABLE_PRICE,
  NO_ACTIVE_PROFESSIONAL. Los mensajes no contienen datos privados.
- Lista de profesionales vacia cuando no hay profesionales compatibles; no
  se presenta una opcion ficticia de asignacion automatica sin candidatas.

Las operaciones de reserva siguen revalidando servicio, asignaciones y agenda;
el catalogo no constituye autorizacion. No hay modelo de aprobacion manual
independiente; no se invento uno ni se altero la politica de servicios variables.

### Disponibilidad y continuaciones

AvailabilityService reutiliza el motor existente con una opcion interna publica:
filtra mediante SchedulingService.publicSlot los horarios pasados, la tolerancia
administrativa y los intervalos fuera de la ventana operativa. Alinea los inicios
publicos a la grilla local de 30 minutos incluso si una jornada empieza a :15.
La llamada administrativa conserva su tolerancia y comportamiento anteriores.
Si el servicio no es reservable en linea, disponibilidad y secuencia responden
400 con la razon de elegibilidad (duracion, precio o duracion invalida), no con
un mensaje generico de duracion variable. Un servicio sin profesional activa
sigue devolviendo una lista vacia de horarios.

Los inicios de secuencia usan la misma grilla de 30 minutos: si la apertura no
cae en :00/:30, el primer inicio publicado es la siguiente marca alineada.

Las visitas secuenciales ya podian publicarse con un segundo servicio a :45,
pero la confirmacion exigia que todos los segmentos comenzaran a :00/:30.
Ahora solo el inicio de la visita debe estar en esa grilla. Las continuaciones
deben encadenarse exactamente con el final anterior y siguen comprobando
duracion, futuro, dia, horario operativo, jornada, asignacion y conflictos.
El permiso de continuacion es interno; no se acepta como parametro del navegador.

El esquema actual no tiene buffers, feriados ni excepciones de calendario.
La politica actual es buffer cero: citas adyacentes son validas. Los descansos
se representan por jornadas separadas y los dias sin jornada no ofrecen horarios.
No se agregaron entidades ni falsas capacidades de calendario para este bloque.

### Comprobantes

La fuente es la union deduplicada de la cita principal y las citas vinculadas a
la solicitud, siempre dentro del spa y ordenadas por inicio. El JSON de segmentos
de una solicitud pendiente ya no determina los tiempos/importes de una cita
confirmada. Funciona con reservas antiguas confirmadas sin esos segmentos.

- Nombres/profesionales reflejan las relaciones actuales de las citas.
- Precio: Appointment.servicePrice. Nunca el precio actual del catalogo.
- Total: suma Decimal de citas CONFIRMED y COMPLETED; las CANCELLED no se suman.
  Representa el valor de servicios vigentes, no un saldo de pagos/reembolsos.
- Inicio/final: minimo inicio y maximo final de las citas vigentes.
- Se conservan los campos escalares originales y se agregan timezone, currency,
  partiallyCancelled y appointments.
- Cada elemento publico de appointments tiene exclusivamente id, serviceName,
  professionalName, start, end, status y price. No expone cedula, telefono,
  correo, comisiones ni otros campos internos.
- Cancelacion parcial: se mantienen todos los elementos con su estado; nombres,
  intervalo y total escalares se calculan solo con los vigentes.
- Cancelacion total: consulta de comprobante devuelve 404; detalles de
  verificacion indican CANCELLED. Repetir cancelacion sigue siendo idempotente.
- expiresAt mantiene su significado previo: vencimiento de verificacion, no una
  nueva fecha de caducidad del comprobante.

La cancelacion del primer segmento ya no oculta los restantes. La cancelacion
publica bloquea solicitud y citas, cancela unicamente citas CONFIRMED y no
reescribe COMPLETED. Si hay servicios completados se devuelve 409 sin cambios:
el cliente debe contactar al spa. No se introduce un flujo automatico de
reembolsos ni se presenta un servicio realizado como cancelado.

### Snapshots y metadatos

Las solicitudes nuevas agregan currency/timezone al JSON de condiciones ofrecidas
(no requiere migracion). Si cambian mientras la solicitud esta pendiente se exige
solicitar nuevamente, igual que ante cambios de precio/duracion en A.

El comprobante nuevo conserva la moneda ofrecida, aunque el spa la cambie despues.
La zona horaria del comprobante es la configuracion actual del spa y sus fechas
son instantes UTC. La vista pendiente conserva la zona/moneda ofrecidas cuando
estan guardadas. Para solicitudes anteriores sin esos metadatos se usa la
configuracion disponible del spa: no es posible reconstruir con certeza una
moneda/zona historica que nunca se almaceno. No se fabricaron backfills.

Reprogramar con la misma profesional ya no recalcula su comision con la tasa
actual: conserva commissionRate y servicePrice. Reasignar explicitamente a otra
profesional conserva el precio y aplica la comision de la nueva asignacion.

## Pendientes A/B adicionales cerrados

- Cancelacion publica de una visita cuyo primer segmento ya estaba cancelado.
- Cancelacion publica concurrente con completar una cita: las escrituras
  administrativas individuales y de reprogramacion de visita exigen que la cita
  siga CONFIRMED; no pisan un estado terminal leido antes por otro proceso.
- La cancelacion publica conserva los servicios completados y su informacion
  financiera, rechazando el cambio en lugar de reescribir la historia.

La auditoria/notificacion aun puede fallar despues del commit: eso sigue en D.

## Archivos

- public-booking-policy.ts y su spec: politica y razones de elegibilidad.
- public-booking.service.ts: catalogo y disponibilidad publica coherentes.
- public-booking-requests.service.ts: snapshots, continuaciones, comprobantes y
  cancelacion publica consistente.
- availability.service.ts: modo publico sobre el motor compartido.
- scheduling.service.ts: continuaciones internas sin relajar el inicio de visita.
- appointments.service.ts: conservar comision en movimientos y escrituras
  condicionadas al estado; spec actualizada para comprobar esa condicion.
- test/integration/public-booking-a.integration-spec.ts: grupos A, B y C sobre
  los mismos fixtures aislados, mas regresiones financieras y de concurrencia.

## Migraciones y contratos

No hay migracion nueva en C. Las 19 migraciones existentes se aplicaron unicamente
a la base temporal vacia de localhost:5433/venueflow_test para ejecutar pruebas.
No hubo instalaciones, despliegues, commits ni modificaciones de frontends.

Rutas y campos originales se conservan. Cambios observables deliberados:

- Servicios de precio variable/sin profesional dejan de anunciarse como INSTANT.
- No se ofrecen horarios publicos que solo caben en la tolerancia administrativa.
- Un comprobante parcialmente cancelado muestra total/intervalo vigentes.
- Cancelar publicamente una visita con servicios completados devuelve 409.

Integracion frontend pendiente (no realizada): usar timezone/currency al
formatear, representar appointments/partiallyCancelled, mostrar razones de
elegibilidad, y conservar Idempotency-Key durante los reintentos de B.
La API ya entrega los datos necesarios; no se afirma que la interfaz actual
muestre todos los nuevos estados o metadatos correctamente.

## Verificacion

Pruebas sobre PostgreSQL 17 real con URL de pruebas validada y fixtures propios.
Incluyen servicios variables/desactivados/sin asignacion, pasado/tolerancia,
grilla, slots publicados aceptados, secuencias de 45 minutos, jornadas separadas,
dias no laborables, adyacencia sin buffer, precios Decimal, cambios de catalogo,
reprogramaciones, comisiones, cancelaciones parciales, servicios completados,
zona/moneda, legacy y carrera entre cancelar/completar. Brevo esta sustituido por
un espia; no hay envios reales.

Resultados finales ejecutados (revalidados el 5 nov 2026 tras alinear mensajes
de elegibilidad y la grilla de secuencias):

| Comando | Resultado |
| --- | --- |
| `node node_modules/prisma/build/index.js migrate deploy` | Las 19 migraciones existentes aplicadas a la base temporal vacia; ninguna migracion nueva de C. |
| `npm test -- --runInBand` sobre scheduling, politica publica, disponibilidad y citas | 4 suites, 40 pruebas aprobadas. No se reejecuto la suite unitaria completa en esta pasada. |
| `npm run test:integration` | 2 suites, 81 pruebas aprobadas sobre PostgreSQL de `localhost:5433/venueflow_test`. |
| `node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand` | 1 suite, 2 pruebas aprobadas. |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.build.json` | Sin errores. |
| `node node_modules/oxlint/bin/oxlint src/ test/` | Sin errores. |
| `git diff --check` | Sin errores; avisos de conversion local LF/CRLF. |

Entorno de integracion: NODE_ENV=test y exclusivamente la base
127.0.0.1:5433/venueflow_test con secreto de prueba. Se mantuvieron los avisos de
VM Modules y deprecacion de pg ya presentes en A/B; no causaron fallos. Se ajusto
una expectativa unitaria anterior para exigir tambien el estado CONFIRMED en la
escritura administrativa y se repitieron las pruebas. La base temporal quedo
detenida al finalizar. No se probaron interfaces frontend ni entrega real Brevo.

## Estado pendiente

El Bloque D sigue pendiente: cooldown atomico, limites de abuso por operacion,
spa/correo, proxies confiables, timeout/reintentos Brevo y errores secundarios de
auditoria. Tambien siguen pendientes la revision/aplicacion autorizada de las
migraciones sobre datos reales, la integracion frontend y la transicion/rotacion
segura de claves legacy descrita en A/B. No se declara la plataforma completa
lista para produccion ni todas las vulnerabilidades eliminadas.
