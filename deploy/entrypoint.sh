#!/bin/sh
# Keep the SQLite schema in sync on every boot, then start the app.
# Runs in the runtime image which ships prisma/, node_modules, src/generated
# and db/ (see Dockerfile). DATABASE_URL is provided by docker-compose env_file.
set -e

echo "[entrypoint] Applying Prisma schema..."
node node_modules/.bin/prisma db push --skip-generate

if [ -n "${DATABASE_SEED:-}" ] && [ "${DATABASE_SEED}" = "true" ]; then
  echo "[entrypoint] Seeding database (users/signals)..."
  node node_modules/.bin/prisma db seed
fi

echo "[entrypoint] Starting TOPTIER server..."
exec node server.js
