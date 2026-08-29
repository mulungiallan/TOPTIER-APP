# ─── TOPTIER web app — production image ───────────────────────────────────────
# Builds the Next.js standalone server (which includes all API routes, Prisma
# and the SQLite DB) and runs it behind Caddy for HTTPS. See DEPLOYMENT.md.
#
# NOTE: the MT5/MT4 trading-bot service is NOT part of this image — the
# MetaTrader5 Python module only works on Windows alongside an installed MT5
# terminal. It runs on a Windows machine and talks to this app over HTTPS.

# ---- Build stage ------------------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Generate the Prisma client into src/generated/prisma and create the SQLite
# DB (so the runtime image ships a schema-ready database file).
RUN npx prisma generate
RUN npm run build

# ---- Runtime stage ----------------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as non-root user
RUN groupadd -r toptier && useradd -r -g toptier -m toptier

# Next.js standalone output (traced server + its node_modules).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Prisma schema + seed + generated client so `prisma db push` and seeds run at
# boot (the standalone trace does NOT include the schema.prisma file itself).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/db ./db
# Only copy the prisma binary + client engine needed at boot — not the full
# node_modules tree (which adds ~200MB+ to the image).
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

RUN chown -R toptier:toptier /app
USER toptier

COPY deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["sh", "entrypoint.sh"]
