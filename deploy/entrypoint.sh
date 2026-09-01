#!/bin/sh
# Keep the Postgres schema in sync on every boot, then start the app.
# Runs in the runtime image which ships prisma/, node_modules and src/generated
# (see Dockerfile). DATABASE_URL must point to a reachable Postgres instance.
set -e

echo "[entrypoint] Applying Prisma schema..."
node node_modules/.bin/prisma db push --skip-generate

if [ -n "${DATABASE_SEED:-}" ] && [ "${DATABASE_SEED}" = "true" ]; then
  echo "[entrypoint] Seeding database (users/signals)..."
  node node_modules/.bin/prisma db seed
fi

echo "[entrypoint] Starting TOPTIER server..."
exec node server.js
