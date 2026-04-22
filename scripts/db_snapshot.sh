#!/usr/bin/env bash
# Dump or load the DB state snapshot.
#
# Usage:
#   scripts/db_snapshot.sh dump            # -> backend/app/data/snapshot.json
#   scripts/db_snapshot.sh load            # load snapshot into an empty DB
#   scripts/db_snapshot.sh load --force    # load even if DB is non-empty
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Reuse the project's venv if available, fall back to system python.
if [[ -x "backend/.venv/bin/python" ]]; then
  PY="backend/.venv/bin/python"
elif [[ -x ".venv/bin/python" ]]; then
  PY=".venv/bin/python"
else
  PY="python"
fi

export PYTHONPATH="$ROOT:${PYTHONPATH:-}"
exec "$PY" -m backend.app.state_snapshot "$@"
