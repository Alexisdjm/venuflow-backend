#!/bin/bash
set -euo pipefail

IMAGE_NAME="venueflow-api"
DOMAIN="api.tryvenueflow.com"
DB_NETWORK="traefik-net"
BUILD_CONTEXT="."
SUPABASE_PORT="${SUPABASE_PORT:-5432}"

# Jenkins credentials decide the database. This script does not embed a Supabase project.
# Until cutover, bind SUPABASE_USER and SUPABASE_HOST to the project the running container already uses.
if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "Falta SUPABASE_DB_PASSWORD"
  exit 1
fi
if [ -z "${SUPABASE_USER:-}" ] || [ -z "${SUPABASE_HOST:-}" ]; then
  echo "Faltan SUPABASE_USER y SUPABASE_HOST (credenciales de Jenkins)"
  exit 1
fi
if [ "${SUPABASE_PORT}" != "5432" ]; then
  echo "Solo el session pooler en el puerto 5432. El puerto 6543 no sirve para Prisma."
  exit 1
fi
case "${SUPABASE_HOST}" in
  *.pooler.supabase.com) ;;
  *) echo "SUPABASE_HOST debe ser el session pooler (*.pooler.supabase.com)"; exit 1 ;;
esac
case "${SUPABASE_USER}" in
  postgres.*|prisma.*) ;;
  *) echo "SUPABASE_USER debe ser postgres.PROJECT_REF"; exit 1 ;;
esac
if [ -z "${JWT_ACCESS_SECRET:-}" ] || [ "${#JWT_ACCESS_SECRET}" -lt 32 ]; then
  echo "Falta JWT_ACCESS_SECRET de al menos 32 caracteres (credencial de Jenkins)"
  exit 1
fi
if [ "${VENUEFLOW_ENV:-}" = "production" ]; then
  if [ -z "${PUBLIC_BOOKING_TOKEN_SECRET:-}" ] || [ "${#PUBLIC_BOOKING_TOKEN_SECRET}" -lt 32 ]; then
    echo "VENUEFLOW_ENV=production exige PUBLIC_BOOKING_TOKEN_SECRET de al menos 32 caracteres"
    exit 1
  fi
  if [ "${PUBLIC_BOOKING_TOKEN_SECRET}" = "${JWT_ACCESS_SECRET}" ]; then
    echo "PUBLIC_BOOKING_TOKEN_SECRET no puede ser igual a JWT_ACCESS_SECRET"
    exit 1
  fi
fi

ENCODED_PASSWORD=$(python3 -c 'import urllib.parse, os; print(urllib.parse.quote(os.environ["SUPABASE_DB_PASSWORD"], safe=""))')
DATABASE_URL="postgresql://${SUPABASE_USER}:${ENCODED_PASSWORD}@${SUPABASE_HOST}:${SUPABASE_PORT}/postgres?sslmode=require"
echo "Database target: user=${SUPABASE_USER%%.*}.… host=${SUPABASE_HOST} port=${SUPABASE_PORT} database=postgres sslmode=require"

docker build -t "${IMAGE_NAME}:${BUILD_NUMBER}" "${BUILD_CONTEXT}"

container_id=$(docker ps -aq --filter "name=^/${IMAGE_NAME}$")
if [ -n "$container_id" ]; then
  docker stop "$container_id" || true
  docker rm "$container_id"
  echo "Detenido y eliminado el contenedor $container_id"
fi

docker run -d \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DATABASE_URL="${DATABASE_URL}" \
  -e JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET}" \
  ${VENUEFLOW_ENV:+-e VENUEFLOW_ENV="${VENUEFLOW_ENV}"} \
  ${PUBLIC_BOOKING_TOKEN_SECRET:+-e PUBLIC_BOOKING_TOKEN_SECRET="${PUBLIC_BOOKING_TOKEN_SECRET}"} \
  ${BREVO_API_KEY:+-e BREVO_API_KEY="${BREVO_API_KEY}"} \
  ${BREVO_SENDER_EMAIL:+-e BREVO_SENDER_EMAIL="${BREVO_SENDER_EMAIL}"} \
  -e JWT_ACCESS_EXPIRES_IN=15m \
  -e REFRESH_TOKEN_EXPIRES_DAYS=30 \
  -e SWAGGER_ENABLED=false \
  -e TRUST_PROXY=false \
  -e CORS_ORIGINS="https://app.tryvenueflow.com" \
  -e BREVO_SENDER_NAME=VenueFlow \
  -e PUBLIC_BOOKING_ROOT_DOMAIN=tryvenueflow.com \
  -e PUBLIC_BOOKING_PROTOCOL=https \
  -l "traefik.enable=true" \
  -l "traefik.http.routers.${IMAGE_NAME}.priority=100" \
  -l "traefik.http.routers.${IMAGE_NAME}.rule=Host(\`${DOMAIN}\`)" \
  -l "traefik.http.routers.${IMAGE_NAME}.service=${IMAGE_NAME}" \
  -l "traefik.http.routers.${IMAGE_NAME}.tls=true" \
  -l "traefik.http.routers.${IMAGE_NAME}.tls.certResolver=letsEncrypt" \
  -l "traefik.http.routers.${IMAGE_NAME}.entryPoints=https" \
  -l "traefik.http.services.${IMAGE_NAME}.loadbalancer.server.port=3000" \
  -l "traefik.docker.network=traefik-net" \
  --name "${IMAGE_NAME}" \
  --restart unless-stopped \
  --network "${DB_NETWORK}" \
  "${IMAGE_NAME}:${BUILD_NUMBER}"

echo "=== estado del contenedor ==="
docker ps -a --filter "name=^/${IMAGE_NAME}$" --format "table {{.Names}}\t{{.Status}}\t{{.Networks}}"

echo "=== redes y labels ==="
docker inspect "${IMAGE_NAME}" --format 'networks={{json .NetworkSettings.Networks}}'
docker inspect "${IMAGE_NAME}" --format 'traefik.enable={{index .Config.Labels "traefik.enable"}} host={{index .Config.Labels "traefik.http.routers.venueflow-api.rule"}} resolver={{index .Config.Labels "traefik.http.routers.venueflow-api.tls.certResolver"}}'

echo "=== health interno (sin Traefik) ==="
# La imagen tiene curl (Dockerfile), no wget.
healthy=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  body_file="$(mktemp)"
  code=$(docker exec "${IMAGE_NAME}" curl -sS -o /tmp/venueflow-health.json -w "%{http_code}" \
    "http://127.0.0.1:3000/api/v1/health" 2>/dev/null || echo "000")
  docker exec "${IMAGE_NAME}" cat /tmp/venueflow-health.json >"${body_file}" 2>/dev/null || true
  body=$(cat "${body_file}" 2>/dev/null || true)
  rm -f "${body_file}"
  echo "intento ${attempt}: http=${code} body=${body}"
  if [ "${code}" = "200" ] && echo "${body}" | grep -q '"status":"ok"'; then
    echo "health ok"
    healthy=1
    break
  fi
  sleep 3
done

if [ "${healthy}" -ne 1 ]; then
  echo "=== logs del contenedor ==="
  docker logs "${IMAGE_NAME}" --tail 80 || true
  echo "=== prueba de login Postgres (sin imprimir la contraseña) ==="
  docker exec "${IMAGE_NAME}" node -e '
    const { Client } = require("pg");
    const raw = process.env.DATABASE_URL || "";
    let parsed;
    try { parsed = new URL(raw); }
    catch { console.log("url_parse_error"); process.exit(0); }
    const sslmode = parsed.searchParams.get("sslmode");
    const password = decodeURIComponent(parsed.password || "");
    console.log("user=" + decodeURIComponent(parsed.username || ""));
    console.log("host=" + parsed.hostname);
    console.log("port=" + (parsed.port || "5432"));
    console.log("db=" + decodeURIComponent(parsed.pathname.replace(/^\//, "")));
    console.log("sslmode=" + (sslmode || "unset"));
    console.log("password_length=" + password.length);
    if (sslmode === "require") parsed.searchParams.delete("sslmode");
    const client = new Client({
      connectionString: parsed.toString(),
      connectionTimeoutMillis: 8000,
      ssl: sslmode === "require" ? { rejectUnauthorized: false } : undefined,
    });
    client.connect()
      .then(() => client.query("select 1"))
      .then(() => client.end())
      .then(() => console.log("pg=ok"))
      .catch((error) => {
        const message = String(error.message || "").replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
        console.log("pg_code=" + (error.code || ""));
        console.log("pg_message=" + message);
      });
  '

  echo "=== sonda de red a Supabase (sin contraseña) ==="
  docker exec \
    -e PROBE_HOST="${SUPABASE_HOST}" \
    -e PROBE_PORT=5432 \
    "${IMAGE_NAME}" \
    node -e '
      const net = require("net");
      const dns = require("dns").promises;
      const host = process.env.PROBE_HOST;
      const port = Number(process.env.PROBE_PORT || 5432);
      (async () => {
        try {
          const ips = await dns.lookup(host, { all: true });
          console.log("dns=" + JSON.stringify(ips));
        } catch (error) {
          console.log("dns_error=" + error.message);
        }
        await new Promise((resolve) => {
          const socket = net.connect({ host, port }, () => {
            console.log("tcp=ok host=" + host + " port=" + port);
            socket.end();
            resolve();
          });
          socket.setTimeout(8000);
          socket.on("timeout", () => {
            console.log("tcp=timeout host=" + host + " port=" + port);
            socket.destroy();
            resolve();
          });
          socket.on("error", (error) => {
            console.log("tcp=error " + error.message);
            resolve();
          });
        });
      })();
    '

  echo "Diagnóstico: Nest arrancó, pero /health devolvió Database unavailable."
  echo "Revisa en orden:"
  echo "1) Supabase Dashboard: que el proyecto NO esté pausado (Restore)."
  echo "2) Credenciales Jenkins SUPABASE_DB_PASSWORD, SUPABASE_USER y SUPABASE_HOST del session pooler."
  echo "3) Si tcp=timeout/error: el servidor no puede salir a ${SUPABASE_HOST}:5432 (firewall)."
  echo "4) Si tcp=ok y sigue 503: contraseña incorrecta o usuario/host mal en DATABASE_URL."
  exit 1
fi

echo "=== contenedores Traefik visibles para el agente ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -i traefik || echo "No apareció un contenedor con nombre traefik en docker ps."

echo "Despliegue del contenedor terminado."
echo "Si el health interno está ok y desde internet sigue el 404/SSL, el fallo está en Traefik (router, entrypoint o certResolver)."
