# Auditoría de backend de VenueFlow

Fecha: 2026-10-21

## Alcance

Revisión estática y ejecución de pruebas sobre autenticación, autorización, aislamiento multi-tenant, validación, citas, disponibilidad, horarios, servicios, finanzas, configuración, persistencia, dependencias y despliegue. Esta auditoría representa una fotografía del código actual y debe repetirse cuando cambien reglas de negocio, autenticación, esquema de datos o dependencias.

## Resultado ejecutivo

El backend tiene una base saludable: compila, pasa lint, usa validación estricta, Argon2, rotación de refresh tokens, Helmet, CORS explícito, roles y filtros `spaId` en la mayoría de accesos. Las suites existentes pasan, incluida la integración real con PostgreSQL.

La confianza automatizada todavía es baja: `npm test -- --runInBand --coverage` ejecuta solo 5 pruebas y reporta 13.69% de statements y 14.16% de líneas. Los módulos de citas, horarios, servicios y finanzas tienen 0% de cobertura unitaria.

No se encontraron vulnerabilidades críticas ni altas en dependencias de producción. `npm audit --omit=dev` reportó 2 moderadas asociadas a `@nestjs/swagger` y su dependencia `js-yaml`.

## Controles positivos confirmados

- `ValidationPipe` global con `whitelist`, `forbidNonWhitelisted` y `transform`.
- Contraseñas almacenadas con Argon2.
- Tokens de actualización aleatorios, almacenados como hash, rotados y con detección de reutilización por familia.
- Verificación del estado actual del usuario y del spa en cada JWT autenticado.
- Guards de roles en rutas administrativas y profesionales.
- Uso generalizado de claves compuestas `id + spaId` y relaciones multi-tenant en PostgreSQL.
- Helmet y CORS con orígenes configurables.
- Swagger deshabilitado en producción por código.
- Contenedor ejecutado con usuario no privilegiado.
- Variables `.env*` reales ignoradas por Git; solo se versionan ejemplos.
- Snapshots financieros de precio y comisión para evitar alterar reportes históricos.

## Hallazgos

### VF-H01 — Creación de citas no impone jornada ni horario operativo (Alto)

**Resuelto el 2026-10-21.** `AppointmentsService.create` ahora valida en el backend el intervalo de 30 minutos, tiempo futuro, horario operativo completo, jornada activa, profesional activa y asignación del servicio. Estas reglas ya no dependen de que el cliente consulte disponibilidad previamente.

Verificación: pruebas de integración para horario operativo, intervalo inválido, profesional inactiva y ausencia de jornada.

Riesgo residual: mantener la función centralizada al incorporar nuevos flujos de creación o estados activos.

### VF-H02 — Riesgo de doble reserva concurrente (Alto)

**Resuelto el 2026-10-21.** La migración `20261021030000_prevent_appointment_overlap` añade una restricción de exclusión GiST para impedir rangos solapados de citas `CONFIRMED` por profesional. La API traduce el conflicto de base de datos a HTTP 409 tanto al crear como al reprogramar.

Verificación: prueba concurrente real contra PostgreSQL; dos solicitudes simultáneas producen respuestas 201/409 y una sola fila persistida.

Riesgo residual: cualquier estado nuevo que represente una cita activa debe añadirse al predicado de la restricción.

### VF-M01 — Disponibilidad puede incluir profesionales inactivas (Medio)

**Resuelto el 2026-10-21.** La consulta de asignaciones exige ahora `professional.isActive = true`, tanto para disponibilidad general como cuando se filtra una profesional específica.

Verificación: pruebas unitarias para ambos modos de consulta.

### VF-M02 — Se puede completar una cita futura (Medio)

**Resuelto el 2026-10-21.** La transición a `COMPLETED` se rechaza con HTTP 409 mientras `endAt` sea posterior a la hora actual. También se impide completar y reprogramar o transferir en la misma solicitud.

Verificación: prueba de integración que crea una cita futura, intenta completarla y confirma que permanece en `CONFIRMED`.

### VF-M03 — Mutación y auditoría no son atómicas (Medio)

Varias operaciones escriben primero la entidad y después el log. Si el log falla, la API devuelve error aunque la mutación ya ocurrió; un reintento puede duplicar o generar conflictos.

Recomendación: incluir entidad y auditoría en una misma transacción o adoptar un patrón outbox. Definir si un fallo de auditoría debe bloquear la operación.

### VF-M04 — Cobertura automatizada insuficiente (Medio)

Cobertura actual: 13.69% statements, 8.8% branches, 9.8% functions y 14.16% lines. Citas, finanzas, horarios y servicios carecen de pruebas unitarias.

Recomendación: priorizar los escenarios P0/P1 de `TEST_MATRIX.md` y establecer umbrales graduales, empezando por 60% de branches en servicios de dominio críticos y elevándolos con cada iteración.

### VF-M05 — Dependencias con vulnerabilidad moderada (Medio)

`npm audit --omit=dev` detectó `GHSA-r3ph-w7gj-g6xm` en `js-yaml`, transitiva de `@nestjs/swagger`, con riesgo de consumo excesivo de CPU al procesar YAML malicioso. Swagger no se habilita en producción, lo que reduce exposición, pero la dependencia debe actualizarse.

Recomendación: actualizar `@nestjs/swagger`/lockfile a una versión corregida compatible y repetir build, e2e y audit. No usar `npm audit fix --force` sin revisar cambios mayores.

### VF-M06 — Endurecimiento incompleto del JWT (Medio)

El JWT usa secreto robusto por longitud y se revalida contra base de datos, pero no declara algoritmo, issuer ni audience.

Recomendación: fijar `algorithms: ['HS256']`, `issuer` y `audience` tanto al firmar como al verificar; usar secretos distintos por ambiente y rotación documentada.

### VF-L01 — Perfil profesional de administradora no se refleja consistentemente en `/me` (Bajo)

`AuthService.me` selecciona el perfil profesional, pero `MeController` lo reemplaza por `null` para roles distintos de `PROFESSIONAL`. Esto puede volver a mostrar la opción de crear perfil después de una nueva sesión, aunque el backend evita el duplicado.

Recomendación: devolver el perfil también para `SPA_ADMIN`, preservando su rol administrativo.

### VF-L02 — Contrato de intervalos más permisivo que el producto (Bajo)

El DTO de disponibilidad permite cualquier entero entre 5 y 60 minutos, aunque el producto opera con bloques de 30/60. Los servicios también permiten duraciones desde 5 minutos.

Recomendación: documentar la regla definitiva y validarla con `IsIn([30, 60])` para intervalos. Decidir si la duración debe ser múltiplo de 30 o si solo los inicios usan bloques de 30.

### VF-L03 — Auditoría no captura contexto de solicitud (Bajo)

El esquema ofrece `ipAddress` y `userAgent`, pero los eventos actuales no los llenan.

Recomendación: incorporar un contexto de auditoría sanitizado. Si se usa proxy, configurar y probar `trust proxy` antes de confiar en IPs.

### VF-L04 — Retención de sesiones no definida (Bajo)

Las sesiones expiradas y revocadas permanecen indefinidamente.

Recomendación: trabajo programado de limpieza con una política documentada y prueba de que no elimina sesiones vigentes.

## Protección de datos

Los datos de clientes (nombre, teléfono, correo y notas) se almacenan en texto claro a nivel de aplicación. Antes de producción deben confirmarse: TLS obligatorio hacia PostgreSQL, cifrado de disco y backups del proveedor, mínimo privilegio del usuario de base de datos, rotación de credenciales, backups restaurables, política de retención/borrado y exclusión de PII en logs. El cifrado de campos debe evaluarse según el modelo de amenazas y requisitos legales, especialmente para teléfono, correo y notas.

## Evidencia de ejecución

- `npm run lint`: aprobado.
- `npm run build`: aprobado.
- `npm test -- --runInBand --coverage`: 4 suites, 5 pruebas, todas aprobadas.
- `npm run test:e2e -- --runInBand`: 1 suite, 2 pruebas, todas aprobadas.
- Suite PostgreSQL aislada (`5433`): 1 suite, 4 pruebas, todas aprobadas; base temporal retirada al finalizar.
- `npm audit --omit=dev`: 0 críticas, 0 altas, 2 moderadas.

## Política para cambios futuros

Todo cambio debe indicar qué filas de la matriz afecta. Una nueva regla de negocio requiere al menos una prueba positiva, una negativa, una de autorización y, cuando escriba datos compartidos, una prueba de aislamiento multi-tenant y otra de concurrencia/idempotencia. Los cambios de esquema deben probar migración desde el estado anterior, datos existentes y rollback operativo documentado.
