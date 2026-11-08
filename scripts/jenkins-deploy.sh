#!/bin/bash
set -euo pipefail

IMAGE_NAME="venueflow-api"
DOMAIN="api.tryvenueflow.com"
DB_NETWORK="traefik-net"
BUILD_CONTEXT="."
SUPABASE_USER="postgres.tzdeylonxivsjmygccqq"
SUPABASE_HOST="aws-0-us-east-1.pooler.supabase.com"
JWT_ACCESS_SECRET="d36236e23615938f8bef35b692c37157bbaa4779df109dc6339ad0d3380d7efd2c85287c08de98947b3e2352dc602254"

if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "Falta SUPABASE_DB_PASSWORD"
  exit 1
fi
if [ -z "${JWT_ACCESS_SECRET:-}" ] || [ "${#JWT_ACCESS_SECRET}" -lt 32 ]; then
  echo "Falta JWT_ACCESS_SECRET de al menos 32 caracteres"
  exit 1
fi

ENCODED_PASSWORD=$(python3 -c 'import urllib.parse, os; print(urllib.parse.quote(os.environ["SUPABASE_DB_PASSWORD"], safe=""))')
DATABASE_URL="postgresql://${SUPABASE_USER}:${ENCODED_PASSWORD}@${SUPABASE_HOST}:5432/postgres?sslmode=require"

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
  -e JWT_ACCESS_EXPIRES_IN=15m \
  -e REFRESH_TOKEN_EXPIRES_DAYS=30 \
  -e SWAGGER_ENABLED=false \
  -e TRUST_PROXY=false \
  -e CORS_ORIGINS="https://app.tryvenueflow.com" \
  -e BREVO_SENDER_NAME=VenueFlow \
  -e PUBLIC_BOOKING_ROOT_DOMAIN=tryvenueflow.com \
  -e PUBLIC_BOOKING_PROTOCOL=https \
  -l "traefik.enable=true" \
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
