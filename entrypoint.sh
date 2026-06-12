#!/bin/bash
set -e

cd /app/backend

echo "[vocab] Running database migrations…"
alembic upgrade head
echo "[vocab] Migrations complete."

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers 1 \
  --log-level info
