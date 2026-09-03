-- Add per-alert notification preferences to PriceAlert and CustomAlert.
-- Additive only (new columns with defaults) — safe on Postgres and SQLite.

ALTER TABLE "PriceAlert" ADD COLUMN "soundEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PriceAlert" ADD COLUMN "soundUri" TEXT;
ALTER TABLE "PriceAlert" ADD COLUMN "vibrateEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PriceAlert" ADD COLUMN "notifyType" TEXT NOT NULL DEFAULT 'system';

ALTER TABLE "CustomAlert" ADD COLUMN "soundEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CustomAlert" ADD COLUMN "soundUri" TEXT;
ALTER TABLE "CustomAlert" ADD COLUMN "vibrateEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CustomAlert" ADD COLUMN "notifyType" TEXT NOT NULL DEFAULT 'system';
