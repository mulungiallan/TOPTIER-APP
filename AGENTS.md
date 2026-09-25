# AGENTS.md — TOPTIER

Guidance for AI agents working in this repository.

## Stack & structure

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4
- **Database:** SQLite via Prisma 6 (`prisma/schema.prisma`). Prisma client is generated to `src/generated/prisma` — import as `@/generated/prisma`. **Never change the DB schema without a migration** (`npx prisma db push` runs on deploy).
- **Mobile:** Capacitor (Android/iOS wrap the same Next.js app). `@capacitor/core` present.
- **Tests:** Vitest. Config `vitest.config.mts` (alias `@` → `src`, node env, picks up `src/**/*.test.{ts,tsx}`).
- **Lint:** ESLint 9 (`npm run lint` = `eslint .`).
- **State:** Zustand (`src/lib/store.ts`). API client: `src/lib/api.ts`. UI primitives: `src/components/ui/*`.

## High-value commands (Windows / PowerShell 5.1)

```powershell
npm run dev          # Next dev on :3000
npm run test         # vitest run
npm run test:watch   # vitest watch
npx tsc --noEmit     # typecheck (primary gate — run this before EVERY commit)
npm run lint         # eslint .
npm run build        # next build --webpack + copy standalone (SLOW on this machine — prefer Railway build)
npm run db:generate  # prisma generate
npm run db:push      # push schema to SQLite
```

- **PowerShell gotchas:** no `&&` (use `; if ($?) { ... }`). `curl` is an alias for `Invoke-WebRequest`. Avoid `$` in double-quoted strings (interpolation eats it) — use single quotes.
- `rg` is NOT installed; use the Grep tool (or `Select-String`).
- Local `npm run build` frequently TIMES OUT on this machine. If it hangs, do NOT block on it — rely on `npx tsc --noEmit` locally and let Railway build.

## Deploy flow

1. `npx tsc --noEmit` clean
2. `git add <files>; git commit -m "..."` (only after user asks/after completing a requested feature)
3. `git push origin main`
4. `railway up -d` from repo root (linked to project `peaceful-contentment`, service `toptier`)

**Railway notes:**
- Prod URLs: `https://app.toptier.app` (custom domain; NOT reliably reachable from local machine) and `https://toptier-production.up.railway.app` (reachable).
- Health check: `Invoke-RestMethod -Uri "https://toptier-production.up.railway.app/api/health"` → `{"status":"ok","db":"ok"}`.
- Deploy config: `railway.toml` (build/start) + `.railway/railway.ts` (domains/env). Start command runs `prisma db push --skip-generate`, `scripts/ensure-admin.js`, `scripts/ensure-packages.js`, then standalone server.
- DB is SQLite **on a Railway volume** (`file:/data/db/custom.db`, 500MB) — NOT queryable from local machine. Verify via API endpoints, not direct DB access.
- `NEXT_PUBLIC_APP_URL` and `TOPTIER_BACKEND_URL` point to the Railway URL in `.env`; on Railway they point at `app.toptier.app`.

## Architecture / conventions

- **Auth:** JWT in `Authorization: Bearer` header. `getUserIdFromRequest(request)` (from `@/lib/auth`) for server routes. `verifyToken` for manual decode.
- **API responses:** use `successResponse({...})` / `errorResponse(message, status)` from `@/lib/auth`.
- **Validation:** Zod schemas in `src/lib/validation.ts`, applied with `validateBody`.
- **Pages:** All screens are client components in `src/components/pages/*.tsx`, swapped by `src/components/layout/app-shell.tsx` (page state machine, not separate routes). Root route is `src/app/page.tsx` (landing/login) → `index` in app-shell.
- **Business logic lives in `src/lib/services/*`** (wallet, social, trading, etc.) and `src/lib/payments/*`. Route files are thin.

### Payments system (`src/lib/payments/`)
- Providers registered in `src/lib/payments/registry.ts` (`PaymentProvider` union in `types.ts`, validated in `validation.ts`).
- **To add a payment provider:** (1) add to `PaymentProvider` union in `src/lib/payments/types.ts`; (2) add to `paymentInitSchema` provider enum in `src/lib/validation.ts`; (3) create/find a gateway in `src/lib/payments/`; (4) register in `registry.ts` gateways map + `envChecks`; (5) add to `getAvailableProviders()`.
- `getAvailableProviders()` = what the UI chooser shows. Wallet + PesaPal are the instant methods; mpesa/airtel/mtn/bank are manual (admin confirms).
- Plan catalog is defined in `src/app/api/subscriptions/route.ts` (PLANS) and mirrored in `src/app/api/billing/dashboard/route.ts` (PLAN_CATALOG). **Keep the two in sync.**
- **A-la-carte feature purchases** (sellable products, in `payments/init` PLANS + `subscriptions` PLANS + billing PLAN_CATALOG): signals_monthly $20/30d, bot_quarterly $100/90d, remove_ads $5/one-time. Trial $0 and legacy premium_* plans still exist for existing subscribers / copy-trading but are no longer sold in the subscriptions UI.
- **Entitlements** (`src/lib/entitlements.ts`): `hasSignalsAccess` / `hasBotAccess` / `hasAdFree` gate signals + bot + ads. Legacy premium/lifetime/pro tiers, trial, and admins get full access. Signals = exactly the 2 best daily signals by confidence (see `/api/signals`). Bot still uses `/api/bot/**` gates. Ads show for everyone unless `adsRemoved`, a premium-tier flag, or trial.
- Screenshot analyzer is FREE/unlimited for everyone (`/api/screenshots` has no quota). `remove_ads` purchase sets `adsRemoved`/`adsRemovedAt` lifetime.
- `fulfillPendingPayment` (`src/lib/payments/fulfillment.ts`) stacks signals_monthly (+30d) and bot_quarterly (+90d) from `max(now, existing expiry)`; `remove_ads` is idempotent/lifetime.
- Wallet payment (provider `'wallet'`) is handled inline in `/api/payments/init` (checks USD `getBalance`, `withdrawCash`, then `fulfillPendingPayment`).
- **Idempotency matters:** ledger postings are idempotent by reference; `fulfillPendingPayment` claims only `status: 'pending'` transactions. Never mark a transaction completed before calling it, or fulfillment silently no-ops.

### Wallet (`src/lib/services/wallet.ts`)
- Double-entry ledger: `WalletAccount` user/house accounts, `WalletEntry` postings. `getBalance` = sum of user legs only.
- Cash assets: `CASH_ASSETS = ['USD','EUR','KES','UGX','GBP']`; crypto: `['BTC','ETH','USDT','SOL']`.
- Key ops: `depositCash`, `withdrawCash`, `getBalance`, `fulfillWalletFunding` (marks payment transaction completed). `withdrawCash` throws `insufficient_balance`.

### Referrals
- Registration with a valid code (`src/app/api/auth/route.ts`) links referrer/referred, increments `referralCount`, creates a pending 7-day `premium_days` reward, then calls `grantReferralCashMilestones` (`src/lib/services/referral-rewards.ts`).
- **Milestone reward:** every 100 referrals → $10 USD deposited to wallet (`rewardType: 'wallet_cash'`, idempotent). Backfilled on billing dashboard load.
- Tiers displayed in `src/components/pages/subscriptions.tsx` (`referralTiers`) and `src/app/api/billing/dashboard/route.ts` (`REFERRAL_TIERS`).

### Competitions
- `joinCompetition` (`src/lib/services/social.ts`) deducts `entryFee` from USD wallet balance via `withdrawCash` (reference `COMP_JOIN_<id>_<userId>`).
- Event-hub packages (`src/lib/services/event-hub.ts`): 8 packages, entry fee doubles each (`10 * 2^(n-1)`), 12 players, winner takes fee×10.

### AdMob / mobile
- AdMob merge lives in `src/lib/ads/*`, `src/components/ads/*`. Google Play billing via RevenueCat (`src/lib/play-billing.ts`).

## Workflow rules for the agent

1. **Verify before committing:** ALWAYS `npx tsc --noEmit` (and `npm run test` if logic touched). Fix type errors before commit.
2. Look at the surrounding code first; match existing patterns (response helpers, service layer, validation, similar existing feature).
3. Interpret ambiguous requests: ask or restate. Don't guess payment flows or schema changes silently.
4. Never commit unless the user asked (feature complete + verified). Stage only intended files.
5. When verifying a deployed flow, use the Railway URL via `Invoke-RestMethod`; direct DB reads are not possible.
6. Keep `getAvailableProviders()`/payments/registry/types/validation consistent — a provider missing from any one of these breaks checkout.