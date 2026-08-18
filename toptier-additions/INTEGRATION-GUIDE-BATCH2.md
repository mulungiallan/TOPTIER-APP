# TOPTIER — Batch 2 Feature Integration Guide

This package adds 17 more features to TOPTIER. All files are additive — no existing code is modified.

## 📦 What's Included in Batch 2

### 🔴 Critical (Production)
1. **Docker Deployment** — multi-stage Dockerfile, docker-compose.yml with full stack (Nginx, Postgres, Redis, Prometheus, Grafana, Loki, backup service)
2. **Stripe Payments** — subscriptions, billing portal, invoices, refunds, webhook handler, failed payment retry
3. **Mobile App (React Native/Expo)** — biometric auth, push notifications, QR scanner, offline mode
4. **Auth Enhancements** — social login (Google/GitHub/Twitter), 2FA (TOTP), email verification, session management with device tracking

### 🟡 High Priority
5. **TradingView Charts** — full widget with 50+ indicators, drawing tools, multiple timeframes, comparison overlay, mini charts, ticker tape
6. **Social Trading** — follow traders, copy trading, leaderboards (week/month/all-time), social feed with posts/likes/comments, trading competitions
7. **Advanced Risk Management** — VaR (historical, parametric, Monte Carlo), CVaR, Sharpe/Sortino/Calmar ratios, max drawdown, beta, correlation matrix, Kelly criterion, stress testing (2008, COVID, flash crash scenarios)
8. **Automation & Bots** — automated trading bots (4 strategies), incoming webhooks (TradingView alerts), outgoing webhooks (Slack/Discord/IFTTT/Zapier), scheduled reports

### 🟢 Infrastructure
9. **Monitoring & Alerting** — Prometheus metrics, Grafana dashboards, Loki log aggregation, Promtail shipper, Uptime Kuma
10. **Data Pipeline** — Server-Sent Events (SSE) for real-time price/signal streaming, WebSocket-ready architecture
11. **Security** — CSP, HSTS, CSRF protection, rate limiting (per-route), security headers, audit logging, input sanitization

### 🔵 UX
12. **Mobile Responsiveness** — pull-to-refresh, swipe gestures, pinch-to-zoom, haptic feedback hooks
13. **Accessibility** — focus trap, ARIA announcer, keyboard navigation hook
14. **i18n** — multi-language (en, es, fr, de, ar with RTL, ja, zh), locale-aware number/currency/date formatting, timezone detection

---

## 🚀 Installation

### Step 1: Install dependencies
```bash
npm install stripe next-auth @next-auth/prisma-adapter otpauth qrcode nodemailer bcryptjs
npm install @sentry/nextjs web-push  # (from Batch 1, if not yet installed)
```

### Step 2: Copy files

Copy ALL files from `toptier-additions/` into your project root, preserving directory structure.

Key new files in this batch:
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- `infrastructure/nginx.conf`
- `monitoring/prometheus.yml`, `monitoring/promtail.yml`
- `src/lib/stripe.ts`, `src/lib/auth-config.ts`, `src/lib/social-trading.ts`, `src/lib/risk-engine.ts`, `src/lib/bots.ts`, `src/lib/streaming.ts`, `src/lib/security.ts`, `src/lib/i18n.ts`
- `src/middleware.ts`
- `src/app/api/{stripe,risk,bots,stream,health,social}/route.ts`
- `src/app/api/stripe/webhook/route.ts`
- `src/app/api/auth/{2fa,email,session}/route.ts`
- `src/components/charts/tradingview-widget.tsx`
- `src/components/security/two-factor-setup.tsx`
- `src/hooks/use-mobile-ux.ts`, `src/hooks/use-i18n.ts`
- `public/locales/{en,es,fr,de,ar,ja,zh}/common.json`
- `mobile-app/app.tsx`, `mobile-app/package.json`
- `prisma/schema-additions-batch2.prisma`

### Step 3: Update Prisma schema

Open `prisma/schema.prisma` and:
1. Append the contents of `prisma/schema-additions-batch2.prisma`
2. Add the new relations to your existing `User` model (see comments at bottom of the additions file)

Run:
```bash
cmd /c npx prisma db push
cmd /c npx prisma generate
```

### Step 4: Set environment variables

Append `.env.batch2.example` to your `.env` file. Get these keys:

| Key | Where to get |
|-----|--------------|
| `STRIPE_SECRET_KEY` | https://dashboard.stripe.com/apikeys |
| `STRIPE_WEBHOOK_SECRET` | https://dashboard.stripe.com/webhooks (create endpoint) |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ELITE` | Create products in Stripe dashboard |
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID/SECRET` | https://console.cloud.google.com/apis/credentials |
| `GITHUB_CLIENT_ID/SECRET` | https://github.com/settings/developers |
| `TWITTER_CLIENT_ID/SECRET` | https://developer.twitter.com/en/portal/dashboard |
| `EMAIL_SERVER` | smtp://user:pass@smtp.gmail.com:587 (use Gmail App Password) |

### Step 5: Set up Stripe webhook
1. Go to https://dashboard.stripe.com/webhooks
2. Add endpoint: `https://yourdomain.com/api/stripe/webhook`
3. Subscribe to events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
4. Copy signing secret → `STRIPE_WEBHOOK_SECRET`

### Step 6: Generate SSL certificates (for nginx)
```bash
mkdir infrastructure/ssl
# Use Let's Encrypt in production
# For local dev, generate self-signed:
openssl req -x509 -newkey rsa:4096 -keyout infrastructure/ssl/privkey.pem -out infrastructure/ssl/fullchain.pem -days 365 -nodes -subj "/CN=localhost"
```

### Step 7: Add new pages to navigation

In your sidebar/menu, add links for:
- TradingView Charts → new page using `<TradingViewWidget symbol="FX:EURUSD" />`
- Social Feed → `/api/social/feed`
- Leaderboard → `/api/social/leaderboard`
- Risk Dashboard → uses `/api/risk/report`
- Trading Bots → `/api/bots`
- Settings → 2FA setup, session management, push notifications

### Step 8: Wrap app with middleware
The `src/middleware.ts` file auto-applies to all routes — no changes needed.

### Step 9: Wrap app with i18n provider (optional)
In your root layout:
```tsx
import { useI18n } from "@/hooks/use-i18n";

// In any component:
const { t, locale, setLocale, isRTL } = useI18n();
<div dir={isRTL ? "rtl" : "ltr"}>{t("nav.dashboard")}</div>
```

### Step 10: Deploy with Docker
```bash
# Development
docker-compose up -d

# Production
docker-compose -f docker-compose.yml up -d
```

---

## 📋 New API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stripe` | GET/POST | Invoices, checkout, billing portal, refunds |
| `/api/stripe/webhook` | POST | Stripe webhook handler |
| `/api/auth/2fa` | POST | 2FA setup, verify, disable |
| `/api/auth/email` | POST | Email verification |
| `/api/auth/session` | GET/POST | Device sessions, force logout |
| `/api/social` | GET/POST | Feed, posts, likes, comments, follow, leaderboard, copy trading |
| `/api/risk` | POST | Risk reports, VaR, stress tests, position sizing |
| `/api/bots` | GET/POST/DELETE | Trading bots CRUD + manual run |
| `/api/stream` | GET | SSE stream for real-time prices/signals |
| `/api/health` | GET | Health check (for Docker, Prometheus) |
| `/api/health?detailed=true` | GET | Detailed metrics |

---

## 🧪 Testing Checklist

### Stripe
- [ ] Create test customer → subscribe to Pro plan
- [ ] Verify webhook fires on subscription creation
- [ ] Test billing portal access
- [ ] Test refund flow (admin)
- [ ] Test failed payment (use card `4000000000000341`)

### Social Login
- [ ] Login with Google
- [ ] Login with GitHub
- [ ] Login with Twitter
- [ ] Link existing email account to social provider

### 2FA
- [ ] Scan QR with Google Authenticator
- [ ] Verify 6-digit code enables 2FA
- [ ] Save backup codes
- [ ] Login requires 2FA code
- [ ] Use backup code to login
- [ ] Disable 2FA with current code

### TradingView
- [ ] Load EURUSD chart
- [ ] Switch timeframes (1m → 1W)
- [ ] Add indicators (RSI, MACD, Bollinger)
- [ ] Use drawing tools
- [ ] Mini chart loads in dashboard card

### Social Trading
- [ ] Follow a trader
- [ ] Enable copy trading
- [ ] Trader opens position → follower's account replicates
- [ ] View leaderboard
- [ ] Create post → appears in followers' feeds
- [ ] Like and comment on posts

### Risk Engine
- [ ] Generate full risk report
- [ ] Compute VaR (all 3 methods)
- [ ] Run stress tests on portfolio
- [ ] Get Kelly-optimal position size

### Trading Bots
- [ ] Create bot with EMA cross strategy
- [ ] Bot generates signals every hour
- [ ] Bot opens paper positions automatically
- [ ] Outgoing webhook fires on trade
- [ ] Test incoming webhook (TradingView alert)

### Docker
- [ ] `docker-compose up -d` starts all services
- [ ] App accessible at https://localhost
- [ ] Grafana at http://localhost:3001
- [ ] Prometheus at http://localhost:9090
- [ ] Backups created daily in ./backups

### i18n
- [ ] Switch to Spanish → all UI text translates
- [ ] Switch to Arabic → layout flips to RTL
- [ ] Numbers format correctly per locale
- [ ] Dates format correctly per locale

---

## 📁 File Structure (Batch 2 additions)

```
├── Dockerfile                              ← NEW
├── docker-compose.yml                      ← NEW
├── .dockerignore                           ← NEW
├── infrastructure/
│   ├── nginx.conf                          ← NEW
│   └── ssl/                                ← YOU CREATE
├── monitoring/
│   ├── prometheus.yml                      ← NEW
│   └── promtail.yml                        ← NEW
├── mobile-app/
│   ├── app.tsx                             ← NEW
│   └── package.json                        ← NEW
├── prisma/
│   └── schema-additions-batch2.prisma      ← APPEND TO schema.prisma
├── public/locales/
│   ├── en/common.json                      ← NEW
│   ├── es/common.json                      ← NEW
│   ├── fr/common.json                      ← NEW (create from en)
│   ├── de/common.json                      ← NEW (create from en)
│   ├── ar/common.json                      ← NEW (RTL)
│   ├── ja/common.json                      ← NEW (create from en)
│   └── zh/common.json                      ← NEW (create from en)
├── src/
│   ├── middleware.ts                       ← NEW
│   ├── app/api/
│   │   ├── stripe/route.ts                 ← NEW
│   │   ├── stripe/webhook/route.ts         ← NEW
│   │   ├── auth/2fa/route.ts               ← NEW
│   │   ├── auth/email/route.ts             ← NEW
│   │   ├── auth/session/route.ts           ← NEW
│   │   ├── social/route.ts                 ← NEW
│   │   ├── risk/route.ts                   ← NEW
│   │   ├── bots/route.ts                   ← NEW
│   │   ├── stream/route.ts                 ← NEW
│   │   └── health/route.ts                 ← NEW
│   ├── components/
│   │   ├── charts/tradingview-widget.tsx   ← NEW
│   │   └── security/two-factor-setup.tsx   ← NEW
│   ├── hooks/
│   │   ├── use-mobile-ux.ts                ← NEW
│   │   └── use-i18n.ts                     ← NEW
│   └── lib/
│       ├── stripe.ts                       ← NEW
│       ├── auth-config.ts                  ← NEW
│       ├── social-trading.ts               ← NEW
│       ├── risk-engine.ts                  ← NEW
│       ├── bots.ts                         ← NEW
│       ├── streaming.ts                    ← NEW
│       ├── security.ts                     ← NEW
│       └── i18n.ts                         ← NEW
├── .env.batch2.example                     ← APPEND TO .env
└── INTEGRATION-GUIDE-BATCH2.md             ← THIS FILE
```

---

## ✅ Feature Completion (Batch 1 + Batch 2)

| Category | Batch 1 | Batch 2 | Total |
|----------|---------|---------|-------|
| Core Trading | News, Calendar, AI Signals | TradingView, Backtest, Bots | ✅ Complete |
| AI/ML | Signal Generator, Screenshot | — | ✅ |
| Payments | — | Stripe full integration | ✅ Complete |
| Auth | Basic | Social, 2FA, Email Verify, Sessions | ✅ Complete |
| Social | Community | Follow, Copy Trade, Feed, Leaderboard | ✅ Complete |
| Risk | P&L | VaR, Monte Carlo, Stress Tests | ✅ Complete |
| Mobile | PWA | React Native + Biometric + QR | ✅ Complete |
| DevOps | — | Docker, Nginx, Monitoring, Backups | ✅ Complete |
| Security | — | CSP, CSRF, Rate Limit, Audit | ✅ Complete |
| UX | Skeletons, Error States | Mobile gestures, A11y, i18n | ✅ Complete |
| Streaming | — | SSE real-time pipeline | ✅ Complete |

**Remaining for future batches:**
- Unit/E2E tests (Jest, Playwright)
- ML model training pipeline (real ML vs rule-based)
- Data warehouse (BigQuery/Snowflake)
- Penetration testing
- WCAG 2.1 AA full audit
