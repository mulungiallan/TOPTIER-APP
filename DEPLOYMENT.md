# Deploying TOPTIER — iPhone, Android & Desktop

TOPTIER is a **Progressive Web App (PWA)**: one codebase that users install to
their home screen on iPhone (Safari), Android (Chrome), Windows (Edge/Chrome)
and Mac (Safari/Chrome). Installation requires **HTTPS** and a publicly
reachable server — that is what a VPS gives you.

> Important: the MT5/MT4 **trading-bot service** only runs on **Windows**
> (the `MetaTrader5` Python module needs an installed, logged-in MT5 terminal).
> This decides which deployment path you pick below.

---

## Path A — One Windows VPS runs EVERYTHING (recommended)

Everything on one machine: the web app, the database, the bot service and the
MetaTrader terminals. Matches how the app already runs on your PC.

### 1. Rent a Windows VPS
- 2–4 GB RAM, 2+ vCPU (e.g. Windows Server 2019/2022, ~$15–30/mo).
- Open **inbound** ports: `80` and `443` (web) and `8765` if you need to reach
  the bot service directly (not required if everything is on one box).

### 2. Install on the VPS
- Node.js **20 LTS** (https://nodejs.org)
- Python **3.9+** (tick "Add to PATH")
- MetaTrader 5 (and MetaTrader 4 if you support MT4). Log in with the broker
  account. **Leave the terminal running.**
- Git (https://git-scm.com) or just zip-copy the project folder onto the VPS.

### 3. Put the app on the server
```
git clone <your-repo> C:\app       # or unzip the project there
cd C:\app
npm install
npx prisma generate
npx prisma db push
npm run build
```

### 4. Create `.env` (production)
Copy `.env.example` to `.env` and set **at minimum**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://USER:PASSWORD@HOST:5432/railway?schema=public` |
| `NEXT_PUBLIC_APP_URL` | `https://yourdomain.com` |
| `NEXTAUTH_SECRET` | a long random string (do not change later) |
| `BOT_SERVICE_URL` | `http://127.0.0.1:8765` (same box) |
| `BOT_SERVICE_KEY` | a long random shared secret |
| `BOT_CREDENTIALS_SECRET` | a long random secret (do not change later) |

The app uses **Postgres** (Prisma provider is `postgresql`). Use a managed
Postgres instance (Railway, Supabase, Neon). On Railway, attach the Postgres
plugin to the service — its `DATABASE_URL` is injected automatically. The
`@` in a password must be URL-encoded as `%40` in the connection string.

`BOT_SERVICE_KEY` must be **identical** in the app `.env` and in the bot
service's environment (step 5). Changing `BOT_CREDENTIALS_SECRET` makes stored
broker passwords undecryptable.

### 5. Run the bot service (Windows)
```
cd C:\app\mini-services\bot
pip install -r ..\..\mt5_trading_bot\requirements.txt
pip install -r requirements.txt
set BOT_SERVICE_KEY=the-same-long-shared-secret
uvicorn server:app --host 127.0.0.1 --port 8765
```
Run it as a background service so it survives reboots (e.g. NSSM:
`nssm install ToptierBot "C:\Python39\python.exe" "-m uvicorn server:app --host 127.0.0.1 --port 8765"` with working dir `C:\app\mini-services\bot`).

### 6. Run the web app (Windows)
```
cd C:\app
npx pm2 start node_modules\next\dist\bin\next --name toptier -- start -p 3000
npx pm2 save
npx pm2-windows-startup install    # start on boot
```

### 7. HTTPS (needed for installable PWA)
**Option 1 — Caddy (simplest, automatic certificates):** download the Windows
Caddy binary, create a `Caddyfile`:
```
yourdomain.com {
	encode gzip zstd
	reverse_proxy 127.0.0.1:3000
}
```
Run `caddy run`. Point your domain's DNS A record at the VPS IP first.

**Option 2 — Cloudflare Tunnel (no open ports needed):** install
`cloudflared`, then `cloudflared tunnel --url http://127.0.0.1:3000` for a
quick test, or set up a named tunnel for a permanent URL.

### 8. Install on your devices
- **iPhone**: open the site in Safari → Share → *Add to Home Screen*.
- **Android**: open in Chrome → menu → *Install app / Add to Home Screen*.
- **Windows/Mac**: open in Chrome/Edge → install icon in the address bar.

---

## Path B — Linux VPS (Docker) for the app + Windows box for the bot

Use this when you want the web app on cheap Linux hosting and keep the bot on
a Windows machine.

```
# on the Linux VPS
git clone <your-repo> && cd <repo>
cp .env.example .env      # set DATABASE_URL, secrets, NEXT_PUBLIC_APP_URL
nano deploy/Caddyfile     # replace yourdomain.example with your real domain
docker compose up -d --build
```
- DNS A record → VPS IP. Caddy issues the HTTPS certificate automatically.
- Postgres runs as the `db` service in `docker-compose.yml`; its data persists in the `db_data` volume. `DATABASE_URL` is wired to it automatically.

The bot service still runs on **Windows** (`Path A`, step 5), with one change:
- `BOT_SERVICE_URL` in the app's `.env` must point to where the bot service is
  reachable, e.g. `http://203.0.113.10:8765` (a Windows VPS) — NOT your home PC
  unless you port-forward or use a tunnel, because the app needs to *reach*
  the service to start/stop bots.
- The webhook URL the app hands the bot service is built from
  `NEXT_PUBLIC_APP_URL` → `https://yourdomain.com/api/bot/webhook` (public, no
  extra config).

---

## Why a PWA (not App Store / Play Store) for now

- One codebase, zero fees, updates instantly, works offline-ish.
- If you later want real App Store / Play Store apps, the Capacitor shells
  (`@capacitor/ios`, `@capacitor/android`) are already configured — you just
  point them at your hosted URL, then follow Apple's ($99/yr) and Google's
  ($25) submission steps. The code is ready; only the accounts are missing.

## Checklist before going live
- [ ] Real domain pointed at your server + HTTPS working
- [ ] `NEXTAUTH_SECRET`, `BOT_SERVICE_KEY`, `BOT_CREDENTIALS_SECRET` set and never rotated
- [ ] MT5/MT4 terminals logged in and left running on the Windows box
- [ ] `NEXT_PUBLIC_PAYMENTS_ENABLED` and payment keys only after real provider keys
- [ ] Test on a real phone (iPhone + Android) and a laptop before telling users
