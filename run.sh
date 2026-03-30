#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-./.venv/bin/python}"
if [[ ! -x "$PY" ]]; then
  echo "Crie o ambiente: /usr/bin/python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi
exec "$PY" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
