#!/usr/bin/env bash
# Stop the local Postgres container created by start_postgres_podman.sh.
set -euo pipefail

CONTAINER_NAME=${CONTAINER_NAME:-pvs_postgres}
VOLUME_NAME=${VOLUME_NAME:-pvs_postgres_data}

if ! command -v podman >/dev/null 2>&1; then
  echo "podman not found." >&2
  exit 1
fi

if podman ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Stopping ${CONTAINER_NAME}..."
  podman stop "${CONTAINER_NAME}"
else
  echo "${CONTAINER_NAME} is not running."
fi

if [[ "${REMOVE:-}" == "1" ]]; then
  podman rm -f "${CONTAINER_NAME}" 2>/dev/null || true
  podman volume rm "${VOLUME_NAME}" 2>/dev/null || true
  echo "Removed container and volume."
fi
