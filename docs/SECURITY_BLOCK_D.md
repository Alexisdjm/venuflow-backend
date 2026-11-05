# Bloque D: operacion y resiliencia

Cierra la intervencion A–D en el backend. No modifica frontends, no activa
`trust proxy` y no agrega Redis, colas ni reintentos automaticos de Brevo.

## Cambios

- Reenvio publico: `updateMany` condicional sobre solicitud pendiente, vigente y
  con cooldown vencido. Dos peticiones simultaneas producen un solo correo.
  Si Brevo falla, se libera ese cooldown para un reintento manual. No hay
  reintento automatico.
- Creacion publica: maximo 5 solicitudes por spa y correo en 10 minutos (429).
  El mensaje no indica si el correo ya era cliente.
- Throttler: lecturas publicas 60/min, secuencia 20/min, escrituras publicas
  10/min, resto 100/min. Salud excluida. El contador es por proceso y usa la IP
  de la conexion, no `X-Forwarded-For`.
- `TRUST_PROXY` queda en false. Solo `true` o `1` hace que Express confie en un
  unico proxy. No se activa hasta que Traefik sobrescriba ese header.
- Brevo: un intento, timeout de 10 segundos. Un fallo de red no se reintenta.
- Auditoria: un fallo de escritura se registra sin metadata ni tokens y no
  convierte la operacion ya confirmada en HTTP 500.
- Correos posteriores a cancelar o reprogramar usan el mismo criterio. El
  primer correo de una solicitud nueva sigue siendo obligatorio: si falla, la
  solicitud se elimina porque el cliente aun no recibio el enlace.

## Verificacion

| Comando | Resultado |
| --- | --- |
| `npm test -- --runInBand` sobre after-commit, auditoria, correo y citas | 4 suites, 30 pruebas aprobadas. |
| `npm run test:integration` | 2 suites, 84 pruebas aprobadas en `localhost:5433/venueflow_test`. |

No hay migracion nueva en D.

## Limite conocido

Varias instancias no comparten el limite en memoria. El cupo por correo si esta
en PostgreSQL. No hay bandeja de salida: un correo posterior a una confirmacion
puede perderse y quedar solo en el log. La reserva confirmada sigue siendo valida.
