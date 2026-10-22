# Matriz de escenarios del backend

Estados: `EXISTE`, `PARCIAL`, `FALTA`. Prioridades: P0 bloquea producción; P1 alta; P2 mantenimiento.

| ID | Área | Escenario | Nivel | Estado | Prioridad |
|---|---|---|---|---|---|
| AUTH-01 | Login | Credenciales válidas generan tokens | Unit | EXISTE | P0 |
| AUTH-02 | Login | Usuario, contraseña o spa inactivo usan error público uniforme | Unit/Integration | PARCIAL | P0 |
| AUTH-03 | Login | Rate limit tras 5 intentos por minuto | E2E | FALTA | P0 |
| AUTH-04 | DTO | Campos desconocidos y formatos inválidos son rechazados | E2E | EXISTE | P1 |
| AUTH-05 | Refresh | Rotación invalida token anterior y reutilización revoca familia | Integration | EXISTE | P0 |
| AUTH-06 | Refresh | Token expirado, inexistente o de usuario suspendido | Unit/Integration | FALTA | P0 |
| AUTH-07 | Logout | Revoca toda la familia y es idempotente | Integration | FALTA | P1 |
| AUTH-08 | JWT | Algoritmo, issuer, audience y secreto incorrecto | Integration | FALTA | P1 |
| RBAC-01 | Roles | Cada rol solo accede a sus controladores | E2E | PARCIAL | P0 |
| TENANT-01 | Multi-tenant | Admin A no lee ni modifica profesionales de B | Integration | EXISTE | P0 |
| TENANT-02 | Multi-tenant | Aislamiento en servicios, horarios, citas, finanzas y auditoría | Integration | FALTA | P0 |
| TENANT-03 | Base de datos | Relaciones cruzadas entre spas fallan por FK | Integration | PARCIAL | P0 |
| PRO-01 | Profesionales | Crear profesional normal, correo duplicado y comisión límite | Unit/Integration | FALTA | P1 |
| PRO-02 | Administradora | Crear perfil profesional sobre la misma cuenta | Integration | FALTA | P1 |
| PRO-03 | Administradora | Segundo perfil es rechazado de forma controlada | Integration | FALTA | P1 |
| PRO-04 | Administradora | Pausar perfil no suspende acceso administrativo | Integration | FALTA | P0 |
| PRO-05 | Profesional | Pausar profesional normal suspende su inicio de sesión | Integration | FALTA | P0 |
| SVC-01 | Servicios | Crear/editar con precio, duración y nombre válidos | Unit | FALTA | P1 |
| SVC-02 | Servicios | Nombre duplicado y precio/duración inválidos | Unit/Integration | FALTA | P1 |
| SVC-03 | Asignación | Asignar/desasignar idempotentemente dentro del spa | Integration | FALTA | P1 |
| SCH-01 | Horarios | Crear y editar dentro del horario operativo | Unit | FALTA | P0 |
| SCH-02 | Horarios | Rechazar inicio >= fin y fuera de apertura/cierre | Unit | FALTA | P0 |
| SCH-03 | Horarios | Rechazar solapamientos; permitir bloques contiguos | Unit/Integration | FALTA | P0 |
| SCH-04 | Horarios | Activar/desactivar y eliminar con aislamiento tenant | Integration | FALTA | P1 |
| SPA-01 | Configuración | Apertura < cierre y límites 0..1440 | Unit/E2E | FALTA | P1 |
| SPA-02 | Configuración | Reducir horario con jornadas incompatibles falla | Integration | FALTA | P1 |
| AVL-01 | Disponibilidad | Slots respetan zona horaria y duración | Unit | EXISTE | P0 |
| AVL-02 | Disponibilidad | Oculta citas solapadas y canceladas liberan el slot | Unit | FALTA | P0 |
| AVL-03 | Disponibilidad | No devuelve horas pasadas para hoy | Unit | FALTA | P0 |
| AVL-04 | Disponibilidad | No devuelve profesionales/servicios/jornadas inactivos | Unit | PARCIAL: profesional inactiva cubierta | P0 |
| AVL-05 | DST | Cambios de horario de verano no duplican/omiten slots incorrectamente | Unit | FALTA | P1 |
| APT-01 | Citas | Crear en slot válido con profesional específica | Unit/Integration | FALTA | P0 |
| APT-02 | Citas | Asignación automática elige solo profesional activa y capacitada | Unit | FALTA | P0 |
| APT-03 | Citas | Rechazar pasado, intervalo inválido, fuera de jornada y fuera del spa | Unit/Integration | PARCIAL: integración cubre intervalo, jornada y spa | P0 |
| APT-04 | Citas | Rechazar servicio/profesional inactivo o no asignado | Integration | PARCIAL: profesional inactiva cubierta | P0 |
| APT-05 | Conflictos | Rechazar solapamiento parcial, total y envolvente | Unit | FALTA | P0 |
| APT-06 | Concurrencia | Dos reservas simultáneas producen exactamente una cita | Integration | EXISTE | P0 |
| APT-07 | Reprogramar | Cambiar hora/profesional recalcula conflicto y comisión | Unit/Integration | FALTA | P0 |
| APT-08 | Estados | CONFIRMED → COMPLETED/CANCELLED; terminales son inmutables | Unit | FALTA | P0 |
| APT-09 | Estados | No completar antes de finalizar el servicio | Integration | EXISTE | P1 |
| APT-10 | Profesional | Profesional solo lista/crea/modifica sus propias citas | Integration | FALTA | P0 |
| FIN-01 | Finanzas | Solo citas COMPLETED cuentan como ingreso | Unit | FALTA | P0 |
| FIN-02 | Finanzas | Bruto, comisión y neto con redondeo decimal correcto | Unit | FALTA | P0 |
| FIN-03 | Finanzas | Rangos día/semana/mes respetan zona horaria | Unit | FALTA | P0 |
| FIN-04 | Finanzas | Snapshot no cambia al editar precio/comisión posterior | Integration | FALTA | P0 |
| FIN-05 | Finanzas | Desglose por profesional y servicio suma los totales | Unit | FALTA | P1 |
| FIN-06 | Finanzas | Admin A no consulta ingresos de B | Integration | FALTA | P0 |
| AUD-01 | Auditoría | Acciones críticas crean evento con actor y tenant | Integration | FALTA | P1 |
| AUD-02 | Auditoría | Mutación y evento son atómicos ante fallo | Integration | FALTA | P1 |
| SEC-01 | HTTP | Helmet, CORS permitido/rechazado y Swagger fuera de producción | E2E | FALTA | P1 |
| SEC-02 | Datos | Respuestas nunca exponen passwordHash, tokenHash o secretos | E2E | FALTA | P0 |
| SEC-03 | PII | Logs y errores no incluyen datos sensibles | E2E/Review | PARCIAL | P0 |
| OPS-01 | Migración | Migraciones aplican sobre base vacía y base con datos previos | Integration | PARCIAL | P1 |
| OPS-02 | Salud | Health falla correctamente cuando PostgreSQL no responde | Integration | FALTA | P1 |

## Reglas de mantenimiento

1. Cada incidencia corregida debe convertir al menos una fila `FALTA` en `EXISTE`.
2. Una funcionalidad nueva añade sus escenarios antes de escribir la implementación.
3. No se acepta reducir cobertura de los servicios de dominio modificados.
4. P0 se ejecuta en cada pull request; P1 en pull request o pipeline nocturno; P2 en mantenimiento programado.
5. Las pruebas de integración usan exclusivamente PostgreSQL temporal en `localhost:5433` y nunca la base de desarrollo.
