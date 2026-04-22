#!/usr/bin/env bash
# Start a Postgres container using Podman for local development.
# Mirrors the pattern from optum-ecp/hs-summarization-agents-fastapi.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PG_USER=${PG_USER:-postgres}
PG_PASSWORD=${PG_PASSWORD:-postgres}
PG_DATABASE=${PG_DATABASE:-pvs}
PG_HOST=${PG_HOST:-127.0.0.1}
PG_PORT=${PG_PORT:-55432}

VOLUME_NAME=${VOLUME_NAME:-pvs_postgres_data}
CONTAINER_NAME=${CONTAINER_NAME:-pvs_postgres}
IMAGE=${IMAGE:-docker.io/library/postgres:16-alpine}

echo "Ensuring Podman machine is running..."
if ! command -v podman >/dev/null 2>&1; then
  echo "podman not found in PATH. Install with: brew install podman" >&2
  exit 1
fi
if ! podman system info >/dev/null 2>&1; then
  podman machine init --quiet || true
  podman machine start || true
fi

echo "Ensuring volume ${VOLUME_NAME} exists..."
podman volume exists "${VOLUME_NAME}" >/dev/null 2>&1 || podman volume create "${VOLUME_NAME}"

if podman ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Container ${CONTAINER_NAME} already running."
elif podman ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Starting existing container ${CONTAINER_NAME}..."
  podman start "${CONTAINER_NAME}"
else
  echo "Creating new container ${CONTAINER_NAME} (image: ${IMAGE})"
  podman run -d \
    --name "${CONTAINER_NAME}" \
    -e POSTGRES_USER="${PG_USER}" \
    -e POSTGRES_PASSWORD="${PG_PASSWORD}" \
    -e POSTGRES_DB="${PG_DATABASE}" \
    -p "${PG_PORT}":5432 \
    -v "${VOLUME_NAME}":/var/lib/postgresql/data:Z \
    "${IMAGE}"
fi

echo "Waiting for Postgres to accept connections..."
for _ in $(seq 1 60); do
  if podman exec -u "${PG_USER}" "${CONTAINER_NAME}" pg_isready -d "${PG_DATABASE}" >/dev/null 2>&1; then
    echo "Postgres is ready."
    break
  fi
  sleep 1
done

cat <<EOF

Postgres is running:
  host=${PG_HOST} port=${PG_PORT} db=${PG_DATABASE} user=${PG_USER}

DATABASE_URL=postgresql+asyncpg://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DATABASE}

Stop with: ${ROOT_DIR}/scripts/stop_postgres_podman.sh
EOF
