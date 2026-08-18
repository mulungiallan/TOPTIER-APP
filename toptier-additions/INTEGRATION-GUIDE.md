# TOPTIER — Feature Additions Integration Guide

This package adds the following features to TOPTIER without modifying existing code:

## 📦 What's Included

### Critical Features (Week 1)
1. **Real News Feed** — NewsAPI integration with RSS fallback
2. **Economic Calendar** — Alpha Vantage API + static fallback
3. **Push Notifications** — Web Push API + service worker
4. **Error Monitoring** — Sentry integration

### High Priority (Week 2-3)
5. **AI Signal Generator** — Technical indicator-based scoring engine
6. **Screenshot Analyzer** — OpenAI Vision API integration
7. **API Documentation** — Swagger UI at `/api/docs`
8. **Caching Layer** — In-memory + Redis-ready

### Month 1-2 Enhancements
9. **Paper Trading** — Virtual trading account with $100K starting balance
10. **Backtesting Engine** — Test strategies against historical data
11. **PWA Support** — Installable, offline-capable mobile app

### UI/UX Improvements
12. **Advanced Loading States** — Skeletons for charts, tables, cards
13. **Robust Fetch Hook** — Retry, exponential backoff, offline detection
14. **Error Handling** — User-friendly error states with retry buttons

---

## 🚀 Installation Steps

### Step 1: Install dependencies
```bash
npm install web-push @sentry/nextjs
```

### Step 2: Copy files into your project

Copy the following from `toptier-additions/` to your `C:\Users\ravenz\Desktop\ANALYSER` project:

| Source | Destination |
|--------|-------------|
| `src/lib/cache.ts` | `src/lib/cache.ts` |
| `src/lib/news-service.ts` | `src/lib/news-service.ts` |
| `src/lib/calendar-service.ts` | `src/lib/calendar-service.ts` |
| `src/lib/push-service.ts` | `src/lib/push-service.ts` |
| `src/lib/signal-generator.ts` | `src/lib/signal-generator.ts` |
| `src/lib/screenshot-analyzer.ts` | `src/lib/screenshot-analyzer.ts` |
| `src/lib/paper-trading.ts` | `src/lib/paper-trading.ts` |
| `src/lib/backtester.ts` | `src/lib/backtester.ts` |
| `src/lib/sentry.ts` | `src/lib/sentry.ts` |
| `src/hooks/use-push-notifications.ts` | `src/hooks/use-push-notifications.ts` |
| `src/hooks/use-robust-fetch.ts` | `src/hooks/use-robust-fetch.ts` |
| `src/components/loading-skeletons.tsx` | `src/components/loading-skeletons.tsx` |
| `src/components/push-notification-settings.tsx` | `src/components/push-notification-settings.tsx` |
| `src/components/pages/news.tsx` | `src/components/pages/news.tsx` |
| `src/components/pages/paper-trading.tsx` | `src/components/pages/paper-trading.tsx` |
| `src/components/pages/backtest.tsx` | `src/components/pages/backtest.tsx` |
| `src/app/api/news/route.ts` | `src/app/api/news/route.ts` |
| `src/app/api/calendar/route.ts` | `src/app/api/calendar/route.ts` |
| `src/app/api/signals-generate/route.ts` | `src/app/api/signals-generate/route.ts` |
| `src/app/api/screenshot-analyze/route.ts` | `src/app/api/screenshot-analyze/route.ts` |
| `src/app/api/push/subscribe/route.ts` | `src/app/api/push/subscribe/route.ts` |
| `src/app/api/push/unsubscribe/route.ts` | `src/app/api/push/unsubscribe/route.ts` |
| `src/app/api/push/test/route.ts` | `src/app/api/push/test/route.ts` |
| `src/app/api/paper-trade/route.ts` | `src/app/api/paper-trade/route.ts` |
| `src/app/api/backtest/route.ts` | `src/app/api/backtest/route.ts` |
| `src/app/api/docs/route.ts` | `src/app/api/docs/route.ts` |
| `public/sw.js` | `public/sw.js` |
| `public/offline.html` | `public/offline.html` |
| `public/manifest.json` | `public/manifest.json` |

### Step 3: Update Prisma schema
Open `prisma/schema.prisma` and append the models from `prisma/schema-additions.prisma`.
Then add the relations to your existing `User` model:

```prisma
model User {
  // ... existing fields ...
  pushSubscriptions PushSubscription[]
  paperAccount      PaperAccount?
  paperPositions    PaperPosition[]
  paperTrades       PaperTrade[]
  priceAlerts       PriceAlert[]
  backtestRuns      BacktestRun[]
}
```

Run:
```bash
cmd /c npx prisma db push
cmd /c npx prisma generate
```

### Step 4: Set environment variables
Append the contents of `.env.example` to your existing `.env` file. Then get API keys:

- **NewsAPI**: Register at https://newsapi.org/register (free, 100 req/day dev)
- **Alpha Vantage**: https://www.alphavantage.co/support/#api-key (free, 25 req/day)
- **OpenAI Vision**: https://platform.openai.com/api-keys (pay-as-you-go)
- **VAPID keys**: Run `npx web-push generate-vapid-keys` (free)
- **Sentry** (optional): https://sentry.io/signup/ (free tier)

### Step 5: Generate PWA icons
You need two icon files in `public/`:
- `icon-192.png` — 192x192 PNG
- `icon-512.png` — 512x512 PNG
- `badge-72.png` — 72x72 PNG (for notification badge)

You can generate from a logo at https://realfavicongenerator.net/ or use any PNG tool.

### Step 6: Register service worker
Add this script to your root layout (`src/app/layout.tsx`) `<head>` or `<body>`:

```tsx
<script
  dangerouslySetInnerHTML={{
    __html: `
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js').catch(console.error);
        });
      }
    `,
  }}
/>
```

### Step 7: Add manifest link to layout
Add to your `<head>` in `src/app/layout.tsx`:
```tsx
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#00d4ff" />
```

### Step 8: Add routes to your store
In `src/lib/store.ts`, add new pages to your navigation:

```typescript
type Page = "dashboard" | "signals" | "calendar" | "news" | "paper-trading" | "backtest" | "settings";
```

Add navigation buttons in your sidebar/header that call `setPage("news")`, `setPage("paper-trading")`, `setPage("backtest")`.

### Step 9: Update calendar page to use real data
Your existing `src/components/pages/calendar.tsx` should call `/api/calendar` instead of using hardcoded events. The API returns the same shape with the `data` array.

### Step 10: Run the app
```bash
cmd /c npx next dev -p 3000
```

---

## 📋 API Endpoints Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/news?category=forex` | GET | Real-time news feed |
| `/api/calendar?startDate=...&endDate=...` | GET | Economic calendar events |
| `/api/signals-generate?symbol=EURUSD` | GET | AI-generated signal |
| `/api/signals-generate?symbols=EURUSD,GBPUSD` | GET | Batch AI signals |
| `/api/screenshot-analyze` | POST | Analyze chart screenshot with Vision API |
| `/api/push/subscribe` | POST | Subscribe to push notifications |
| `/api/push/unsubscribe` | POST | Unsubscribe from push |
| `/api/push/test` | POST | Send test push notification |
| `/api/paper-trade` | GET | Get paper trading account |
| `/api/paper-trade` | POST | Open/close/reset paper position |
| `/api/backtest` | POST | Run strategy backtest |
| `/api/docs` | GET | Swagger UI |
| `/api/docs?format=json` | GET | OpenAPI spec |

---

## 🧪 Testing the New Features

### 1. Test News Feed
- Open http://localhost:3000 → navigate to News page
- Click category tabs to filter
- Should show real articles from Reuters/Bloomberg/CNBC (if NewsAPI key set) or RSS feeds

### 2. Test Economic Calendar
- Navigate to Calendar page
- Should show events like FOMC, Nonfarm Payrolls, ECB, BoE
- Click an event to see details (forecast/previous/actual)

### 3. Test Push Notifications
- Go to Settings → Push Notifications section
- Click "Enable Notifications"
- Browser will ask for permission
- Click "Send Test" — should see a desktop notification

### 4. Test AI Signal Generator
- Visit http://localhost:3000/api/signals-generate?symbol=EURUSD
- Should return JSON with BUY/SELL signal, confidence, indicators, reasons

### 5. Test Paper Trading
- Navigate to Paper Trading page
- Click "New Position" → fill form → "Open Position"
- Position appears in open positions list with live P&L

### 6. Test Backtesting
- Navigate to Backtest page
- Select EURUSD + EMA Crossover strategy
- Click "Run Backtest"
- Should see equity curve, metrics, and trade history

### 7. Test API Documentation
- Visit http://localhost:3000/api/docs
- Should see interactive Swagger UI

---

## 🎨 Dark Mode

The new pages already use dark theme (`bg-[#0a0a0f]`) matching your existing design. To add a dark mode toggle for the whole app:

1. Add to your store:
```typescript
theme: "dark" as "dark" | "light",
toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
```

2. Wrap your app in a div with conditional `bg-white text-black` vs `bg-[#0a0a0f] text-white` classes.

---

## 🔧 Troubleshooting

### "Cannot find module '@/lib/cache'"
→ Make sure you copied all files from `src/lib/` to your project's `src/lib/`.

### Push notifications not working
→ Check:
- VAPID keys set in `.env`
- Service worker registered (check browser console)
- `web-push` package installed (`npm install web-push`)
- Using HTTPS or localhost

### NewsAPI 426 Upgrade Required
→ NewsAPI free tier requires development to be on localhost. For production, upgrade to paid plan or use the RSS fallback (already implemented).

### Prisma errors after schema changes
→ Run `npx prisma db push` and `npx prisma generate` again.

### OpenAI API 401
→ Verify your `OPENAI_API_KEY` is valid and has Vision API access. The analyzer will fall back to mock analysis if the key is missing or invalid.

---

## 📁 File Structure Summary

```
src/
├── app/api/
│   ├── news/route.ts              ← NEW
│   ├── calendar/route.ts          ← NEW (replaces existing if you want real data)
│   ├── signals-generate/route.ts  ← NEW
│   ├── screenshot-analyze/route.ts ← NEW
│   ├── push/
│   │   ├── subscribe/route.ts     ← NEW
│   │   ├── unsubscribe/route.ts   ← NEW
│   │   └── test/route.ts          ← NEW
│   ├── paper-trade/route.ts       ← NEW
│   ├── backtest/route.ts          ← NEW
│   └── docs/route.ts              ← NEW
├── components/
│   ├── loading-skeletons.tsx      ← NEW
│   ├── push-notification-settings.tsx ← NEW
│   └── pages/
│       ├── news.tsx               ← NEW
│       ├── paper-trading.tsx      ← NEW
│       └── backtest.tsx           ← NEW
├── hooks/
│   ├── use-push-notifications.ts  ← NEW
│   └── use-robust-fetch.ts        ← NEW
└── lib/
    ├── cache.ts                   ← NEW
    ├── news-service.ts            ← NEW
    ├── calendar-service.ts        ← NEW
    ├── push-service.ts            ← NEW
    ├── signal-generator.ts        ← NEW
    ├── screenshot-analyzer.ts     ← NEW
    ├── paper-trading.ts           ← NEW
    ├── backtester.ts              ← NEW
    └── sentry.ts                  ← NEW
public/
├── sw.js                          ← NEW
├── offline.html                   ← NEW
└── manifest.json                  ← NEW
prisma/
└── schema-additions.prisma        ← APPEND TO EXISTING schema.prisma
```

---

## ✅ Feature Checklist

- [x] Real News Feed (NewsAPI + RSS)
- [x] Economic Calendar (Alpha Vantage + static)
- [x] Push Notifications (Web Push + Service Worker)
- [x] AI Signal Generator (multi-indicator scoring)
- [x] Screenshot Analyzer (OpenAI Vision)
- [x] Error Monitoring (Sentry)
- [x] API Documentation (Swagger)
- [x] Caching Layer (memory/Redis)
- [x] Paper Trading (virtual account)
- [x] Backtesting Engine (4 strategies)
- [x] PWA Support (manifest + service worker)
- [x] Advanced Loading States (skeletons)
- [x] Robust Error Handling (retry + backoff + offline)
- [ ] Mobile App (React Native) — future enhancement
- [ ] Social Features — future enhancement
- [ ] TradingView Charts — future enhancement
- [ ] Unit/E2E Tests — future enhancement
- [ ] Rate Limiting — future enhancement
