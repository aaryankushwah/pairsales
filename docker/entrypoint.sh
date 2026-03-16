#!/bin/sh
set -e

# -------------------------------------------------------
# Wait for Postgres to be ready (max 30 seconds)
# -------------------------------------------------------
echo "[entrypoint] Waiting for Postgres at ${DATABASE_URL}..."

TRIES=0
MAX_TRIES=30
# Extract host and port from DATABASE_URL (postgres://user:pass@host:port/db)
PG_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
PG_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
PG_USER=$(echo "$DATABASE_URL" | sed -E 's|.*://([^:]+):.*|\1|')

while [ "$TRIES" -lt "$MAX_TRIES" ]; do
  if pg_isready -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -q 2>/dev/null; then
    echo "[entrypoint] Postgres is ready."
    break
  fi
  TRIES=$((TRIES + 1))
  if [ "$TRIES" -eq "$MAX_TRIES" ]; then
    echo "[entrypoint] ERROR: Postgres not ready after ${MAX_TRIES}s. Aborting."
    exit 1
  fi
  sleep 1
done

# -------------------------------------------------------
# Run database migrations
# -------------------------------------------------------
echo "[entrypoint] Running database migrations..."
pnpm db:migrate
echo "[entrypoint] Migrations complete."

# -------------------------------------------------------
# Seed default agents and project
# -------------------------------------------------------
echo "[entrypoint] Running database seed..."
pnpm db:seed
echo "[entrypoint] Seed complete."

# -------------------------------------------------------
# Hand off to the CMD
# -------------------------------------------------------
echo "[entrypoint] Starting server..."
exec "$@"
