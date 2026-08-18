"""
web_dashboard.py
-------------------
Professional trading bot dashboard with login protection.
Run in a SEPARATE terminal from main.py:

    python web_dashboard.py

Then open:  http://localhost:8765
Default password: set DASHBOARD_PASSWORD in config.py
"""

import json
import os
import csv
import hashlib
import secrets
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import config

PORT = 8765
DASHBOARD_PASSWORD = getattr(config, "DASHBOARD_PASSWORD", "")
SESSION_TIMEOUT = 3600  # 1 hour

# In-memory session store: token -> expiry timestamp
_sessions = {}


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _create_session() -> str:
    token = secrets.token_hex(32)
    _sessions[token] = time.time() + SESSION_TIMEOUT
    return token


def _is_valid_session(token: str) -> bool:
    if not token or token not in _sessions:
        return False
    if time.time() > _sessions[token]:
        del _sessions[token]
        return False
    _sessions[token] = time.time() + SESSION_TIMEOUT  # refresh
    return True


def _get_session_from_cookie(cookie_header: str) -> str:
    if not cookie_header:
        return ""
    for part in cookie_header.split(";"):
        part = part.strip()
        if part.startswith("session="):
            return part[8:]
    return ""


def _load_snapshot() -> dict:
    if not os.path.exists(config.DASHBOARD_SNAPSHOT_FILE):
        return None
    try:
        with open(config.DASHBOARD_SNAPSHOT_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _load_recent_trades(limit: int = 20) -> list:
    if not os.path.exists(config.TRADE_LOG_FILE):
        return []
    try:
        with open(config.TRADE_LOG_FILE, "r", newline="") as f:
            rows = list(csv.DictReader(f))
        return list(reversed(rows))[:limit]
    except OSError:
        return []


def _login_page(error: str = "") -> str:
    error_html = f'<div class="error">{error}</div>' if error else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Trading Bot — Login</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{min-height:100vh;background:linear-gradient(135deg,#0a0e1a 0%,#0d1528 50%,#0a0e1a 100%);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}}
  .card{{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:48px 40px;width:100%;max-width:400px;backdrop-filter:blur(20px)}}
  .logo{{text-align:center;margin-bottom:32px}}
  .logo-icon{{width:64px;height:64px;background:linear-gradient(135deg,#00d4aa,#0066ff);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px}}
  h1{{color:#fff;font-size:22px;font-weight:700;text-align:center;letter-spacing:-0.5px}}
  .sub{{color:#5a6a8a;font-size:13px;text-align:center;margin-top:6px}}
  .field{{margin-top:24px}}
  label{{display:block;color:#8892aa;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px}}
  input{{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:13px 16px;color:#fff;font-size:15px;outline:none;transition:border-color 0.2s}}
  input:focus{{border-color:#00d4aa}}
  .btn{{width:100%;margin-top:28px;padding:14px;background:linear-gradient(135deg,#00d4aa,#0066ff);border:none;border-radius:10px;color:#fff;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:0.02em;transition:opacity 0.2s}}
  .btn:hover{{opacity:0.9}}
  .error{{background:rgba(255,76,76,0.1);border:1px solid rgba(255,76,76,0.3);border-radius:8px;padding:10px 14px;color:#ff6b6b;font-size:13px;margin-top:16px;text-align:center}}
  .dots{{display:flex;justify-content:center;gap:6px;margin-top:28px}}
  .dot{{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.15)}}
  .dot.active{{background:#00d4aa}}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-icon">🤖</div>
    <h1>Trading Bot</h1>
    <p class="sub">Multi-Strategy Forex &amp; Volatility System</p>
  </div>
  <form method="POST" action="/login">
    <div class="field">
      <label>Dashboard Password</label>
      <input type="password" name="password" placeholder="Enter password" autofocus autocomplete="current-password">
    </div>
    {error_html}
    <button class="btn" type="submit">Access Dashboard →</button>
  </form>
  <div class="dots">
    <div class="dot active"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
</div>
</body>
</html>"""


def _dashboard_page(snapshot, trades) -> str:
    if snapshot is None:
        status_html = """
        <div class="waiting">
          <div class="wait-icon">⏳</div>
          <h2>Waiting for bot data...</h2>
          <p>Make sure <strong>main.py</strong> is running. Data appears after the first dashboard refresh cycle.</p>
        </div>"""
        equity = balance = currency = "—"
        open_count = max_pos = 0
        open_risk = ceiling = 0
        stats = {}
        freq = None
        approved = total = 0
    else:
        equity = snapshot.get("equity", 0)
        balance = snapshot.get("balance", 0)
        currency = snapshot.get("currency", "USD")
        positions = snapshot.get("open_positions", [])
        open_count = len(positions)
        max_pos = snapshot.get("max_open_positions", 15)
        open_risk = snapshot.get("open_risk_pct", 0)
        ceiling = snapshot.get("portfolio_risk_ceiling_pct", 10)
        stats = snapshot.get("overall_stats", {})
        freq = snapshot.get("freq_status")
        approved = snapshot.get("approved_combo_count", 0)
        total = snapshot.get("total_combo_count", 0)
        timestamp = snapshot.get("timestamp", "")

        equity_color = "#00d4aa" if float(equity) >= float(balance) else "#ff4c4c"
        pnl = round(float(equity) - float(balance), 2)
        pnl_pct = round((pnl / float(balance) * 100), 2) if float(balance) else 0
        pnl_color = "#00d4aa" if pnl >= 0 else "#ff4c4c"
        pnl_sign = "+" if pnl >= 0 else ""

        # Position rows
        pos_rows = ""
        for p in positions:
            pl = p.get("profit", 0)
            pl_color = "#00d4aa" if pl >= 0 else "#ff4c4c"
            dir_color = "#00d4aa" if p.get("direction") == "BUY" else "#ff4c4c"
            pos_rows += f"""
            <tr>
              <td><span class="pair-badge">{p.get('symbol','')}</span></td>
              <td><span style="color:{dir_color};font-weight:700">{p.get('direction','')}</span></td>
              <td>{p.get('volume','')}</td>
              <td style="color:{pl_color};font-weight:600">{'+' if pl>=0 else ''}{pl:.2f}</td>
            </tr>"""

        if not pos_rows:
            pos_rows = '<tr><td colspan="4" class="empty-row">No open positions</td></tr>'

        # Trade rows
        trade_rows = ""
        for t in trades[:15]:
            res = t.get("result", "")
            res_color = "#00d4aa" if res == "WIN" else ("#ff4c4c" if res == "LOSS" else "#8892aa")
            pl = float(t.get("profit", 0))
            pl_color = "#00d4aa" if pl >= 0 else "#ff4c4c"
            close_time = t.get("close_time", "")[:16].replace("T", " ")
            trade_rows += f"""
            <tr>
              <td>{close_time}</td>
              <td><span class="pair-badge">{t.get('symbol','')}</span></td>
              <td><span class="tf-badge">{t.get('timeframe','')}</span></td>
              <td style="color:{'#00d4aa' if t.get('direction')=='BUY' else '#ff4c4c'}">{t.get('direction','')}</td>
              <td><span class="result-badge" style="background:{res_color}22;color:{res_color}">{res}</span></td>
              <td style="color:{pl_color};font-weight:600">{'+' if pl>=0 else ''}{pl:.2f}</td>
            </tr>"""

        if not trade_rows:
            trade_rows = '<tr><td colspan="6" class="empty-row">No closed trades yet</td></tr>'

        # Win rate ring
        win_rate = stats.get("win_rate_pct", 0) or 0
        wcount = stats.get("wins", 0)
        lcount = stats.get("losses", 0)
        tcount = stats.get("trade_count", 0)
        pf = stats.get("profit_factor", 0) or 0
        total_pl = stats.get("total_profit", 0) or 0
        ring_pct = min(win_rate, 100)
        ring_offset = 283 - (283 * ring_pct / 100)
        ring_color = "#00d4aa" if win_rate >= 50 else "#f59e0b" if win_rate >= 35 else "#ff4c4c"

        # Freq bar
        freq_today = freq.get("trades_today", 0) if freq else 0
        freq_target = freq.get("target", 20) if freq else 20
        freq_pct = min(int(freq_today / freq_target * 100), 100) if freq_target else 0
        relaxation = freq.get("relaxation_level", 0) if freq else 0
        effective_votes = freq.get("effective_min_votes", 2) if freq else 2

        status_html = f"""
        <!-- KPI Row 1 -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Equity</div>
            <div class="kpi-value" style="color:{equity_color}">{equity} <span class="kpi-unit">{currency}</span></div>
            <div class="kpi-sub">Balance: {balance} {currency}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Today's P/L</div>
            <div class="kpi-value" style="color:{pnl_color}">{pnl_sign}{pnl} <span class="kpi-unit">{currency}</span></div>
            <div class="kpi-sub">{pnl_sign}{pnl_pct}% of balance</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Open Positions</div>
            <div class="kpi-value">{open_count} <span class="kpi-unit">/ {max_pos}</span></div>
            <div class="kpi-sub">Risk: {open_risk}% / {ceiling}% ceiling</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Approved Combos</div>
            <div class="kpi-value">{approved} <span class="kpi-unit">/ {total}</span></div>
            <div class="kpi-sub">Symbol × Timeframe × Strategy</div>
          </div>
        </div>

        <!-- Win Rate + Trade Frequency -->
        <div class="mid-grid">
          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">All-time Performance</span>
              <span class="panel-badge">{tcount} trades</span>
            </div>
            <div class="perf-body">
              <div class="ring-wrap">
                <svg viewBox="0 0 100 100" class="ring-svg">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/>
                  <circle cx="50" cy="50" r="45" fill="none" stroke="{ring_color}" stroke-width="8"
                    stroke-dasharray="283" stroke-dashoffset="{ring_offset:.1f}"
                    stroke-linecap="round" transform="rotate(-90 50 50)"/>
                </svg>
                <div class="ring-label">
                  <div class="ring-pct" style="color:{ring_color}">{win_rate:.1f}%</div>
                  <div class="ring-sub">Win Rate</div>
                </div>
              </div>
              <div class="perf-stats">
                <div class="ps-row"><span class="ps-l">Wins</span><span class="ps-r" style="color:#00d4aa">{wcount}</span></div>
                <div class="ps-row"><span class="ps-l">Losses</span><span class="ps-r" style="color:#ff4c4c">{lcount}</span></div>
                <div class="ps-row"><span class="ps-l">Profit Factor</span><span class="ps-r">{pf}</span></div>
                <div class="ps-row"><span class="ps-l">Total P/L</span><span class="ps-r" style="color:{('#00d4aa' if total_pl>=0 else '#ff4c4c')}">{('+' if total_pl>=0 else '')}{total_pl}</span></div>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">Daily Trade Pace</span>
              <span class="panel-badge">{freq_today}/{freq_target} target</span>
            </div>
            <div class="freq-body">
              <div class="freq-bar-wrap">
                <div class="freq-bar">
                  <div class="freq-fill" style="width:{freq_pct}%"></div>
                </div>
                <div class="freq-pct">{freq_pct}%</div>
              </div>
              <div class="freq-stats">
                <div class="ps-row"><span class="ps-l">Trades today</span><span class="ps-r">{freq_today}</span></div>
                <div class="ps-row"><span class="ps-l">Target</span><span class="ps-r">{freq_target}</span></div>
                <div class="ps-row"><span class="ps-l">Relaxation level</span><span class="ps-r">{relaxation}</span></div>
                <div class="ps-row"><span class="ps-l">Effective min votes</span><span class="ps-r">{effective_votes}</span></div>
              </div>
              <div class="branch-badges">
                <span class="branch-badge hv">🔥 HIGH-VOL FIRST</span>
                <span class="branch-badge lv">📊 Low-Vol Secondary</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Open Positions Table -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Open Positions</span>
            <span class="live-dot"><span class="live-pulse"></span>LIVE</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Symbol</th><th>Direction</th><th>Lots</th><th>P/L</th></tr></thead>
              <tbody>{pos_rows}</tbody>
            </table>
          </div>
        </div>

        <!-- Recent Trades Table -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Recent Closed Trades</span>
            <span class="panel-badge">Last 15</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Closed</th><th>Symbol</th><th>TF</th><th>Dir</th><th>Result</th><th>P/L</th></tr></thead>
              <tbody>{trade_rows}</tbody>
            </table>
          </div>
        </div>

        <div class="footer">Last updated: {timestamp} &nbsp;·&nbsp; Auto-refresh every 10s &nbsp;·&nbsp;
          <a href="/logout" class="logout-link">Log out</a></div>
        """

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="10">
<title>Trading Bot Dashboard</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{background:#080c18;color:#e0e6f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh}}
  .topbar{{background:rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.06);padding:0 32px;height:60px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;backdrop-filter:blur(20px)}}
  .topbar-left{{display:flex;align-items:center;gap:12px}}
  .topbar-icon{{width:36px;height:36px;background:linear-gradient(135deg,#00d4aa,#0066ff);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px}}
  .topbar-title{{font-size:16px;font-weight:700;color:#fff;letter-spacing:-0.3px}}
  .topbar-sub{{font-size:12px;color:#5a6a8a;margin-top:1px}}
  .topbar-right{{display:flex;align-items:center;gap:16px}}
  .status-pill{{background:rgba(0,212,170,0.1);border:1px solid rgba(0,212,170,0.25);border-radius:20px;padding:5px 12px;font-size:12px;font-weight:600;color:#00d4aa;display:flex;align-items:center;gap:6px}}
  .status-dot{{width:6px;height:6px;border-radius:50%;background:#00d4aa;animation:pulse 2s infinite}}
  @keyframes pulse{{0%,100%{{opacity:1}}50%{{opacity:0.4}}}}
  .content{{max-width:1400px;margin:0 auto;padding:28px 32px}}
  .kpi-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}}
  @media(max-width:900px){{.kpi-grid{{grid-template-columns:repeat(2,1fr)}}}}
  .kpi-card{{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:20px 22px}}
  .kpi-label{{font-size:11px;font-weight:600;color:#5a6a8a;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px}}
  .kpi-value{{font-size:26px;font-weight:800;color:#fff;letter-spacing:-0.5px;line-height:1}}
  .kpi-unit{{font-size:14px;font-weight:500;color:#5a6a8a}}
  .kpi-sub{{font-size:12px;color:#5a6a8a;margin-top:8px}}
  .mid-grid{{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}}
  @media(max-width:800px){{.mid-grid{{grid-template-columns:1fr}}}}
  .panel{{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:20px 22px;margin-bottom:20px}}
  .panel-header{{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}}
  .panel-title{{font-size:14px;font-weight:700;color:#e0e6f0}}
  .panel-badge{{background:rgba(255,255,255,0.06);border-radius:20px;padding:3px 10px;font-size:11px;color:#8892aa}}
  .live-dot{{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#00d4aa;letter-spacing:0.08em}}
  .live-pulse{{width:7px;height:7px;border-radius:50%;background:#00d4aa;animation:pulse 1.5s infinite}}
  .perf-body{{display:flex;align-items:center;gap:24px}}
  .ring-wrap{{position:relative;width:100px;height:100px;flex-shrink:0}}
  .ring-svg{{width:100%;height:100%}}
  .ring-label{{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}}
  .ring-pct{{font-size:18px;font-weight:800;line-height:1}}
  .ring-sub{{font-size:10px;color:#5a6a8a;margin-top:2px}}
  .perf-stats{{flex:1}}
  .ps-row{{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04)}}
  .ps-row:last-child{{border-bottom:none}}
  .ps-l{{font-size:12px;color:#8892aa}}
  .ps-r{{font-size:13px;font-weight:600;color:#e0e6f0}}
  .freq-body{{display:flex;flex-direction:column;gap:16px}}
  .freq-bar-wrap{{display:flex;align-items:center;gap:12px}}
  .freq-bar{{flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden}}
  .freq-fill{{height:100%;background:linear-gradient(90deg,#00d4aa,#0066ff);border-radius:4px;transition:width 0.5s}}
  .freq-pct{{font-size:13px;font-weight:700;color:#e0e6f0;min-width:36px;text-align:right}}
  .freq-stats{{display:flex;flex-direction:column;gap:0}}
  .branch-badges{{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}}
  .branch-badge{{padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700}}
  .branch-badge.hv{{background:rgba(255,76,76,0.1);color:#ff6b6b;border:1px solid rgba(255,76,76,0.2)}}
  .branch-badge.lv{{background:rgba(0,102,255,0.1);color:#5599ff;border:1px solid rgba(0,102,255,0.2)}}
  .table-wrap{{overflow-x:auto}}
  table{{width:100%;border-collapse:collapse}}
  th{{text-align:left;font-size:11px;font-weight:700;color:#5a6a8a;text-transform:uppercase;letter-spacing:0.06em;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06)}}
  td{{padding:12px 12px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px;color:#c8d0e0}}
  tr:last-child td{{border-bottom:none}}
  .pair-badge{{background:rgba(255,255,255,0.07);border-radius:6px;padding:3px 8px;font-size:12px;font-weight:600;font-family:monospace;color:#e0e6f0}}
  .tf-badge{{background:rgba(0,102,255,0.12);border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;color:#5599ff}}
  .result-badge{{border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700}}
  .empty-row{{text-align:center;color:#5a6a8a;padding:28px!important}}
  .footer{{text-align:center;font-size:12px;color:#3a4a6a;padding:20px 0 32px}}
  .logout-link{{color:#5a6a8a;text-decoration:none}}
  .logout-link:hover{{color:#e0e6f0}}
  .waiting{{text-align:center;padding:80px 20px}}
  .wait-icon{{font-size:48px;margin-bottom:16px}}
  .waiting h2{{color:#e0e6f0;font-size:20px;margin-bottom:8px}}
  .waiting p{{color:#5a6a8a;font-size:14px}}
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-left">
    <div class="topbar-icon">🤖</div>
    <div>
      <div class="topbar-title">Trading Bot</div>
      <div class="topbar-sub">Multi-Strategy &nbsp;·&nbsp; 2-Branch Architecture</div>
    </div>
  </div>
  <div class="topbar-right">
    <div class="status-pill"><span class="status-dot"></span>LIVE</div>
  </div>
</div>

<div class="content">
{status_html}
</div>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def _cookie_session(self):
        return _get_session_from_cookie(self.headers.get("Cookie", ""))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/logout":
            token = self._cookie_session()
            if token in _sessions:
                del _sessions[token]
            self._redirect("/")
            return

        if not _is_valid_session(self._cookie_session()):
            self._serve_html(self._login_html())
            return

        snapshot = _load_snapshot()
        trades = _load_recent_trades()
        self._serve_html(_dashboard_page(snapshot, trades))

    def do_POST(self):
        if self.path != "/login":
            self._redirect("/")
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode()
        params = parse_qs(body)
        password = params.get("password", [""])[0]

        if password == DASHBOARD_PASSWORD:
            token = _create_session()
            self.send_response(302)
            self.send_header("Location", "/")
            self.send_header("Set-Cookie", f"session={token}; HttpOnly; Path=/; Max-Age={SESSION_TIMEOUT}")
            self.end_headers()
        else:
            self._serve_html(_login_page("Incorrect password. Please try again."))

    def _login_html(self):
        return _login_page()

    def _serve_html(self, html):
        encoded = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(encoded))
        self.end_headers()
        self.wfile.write(encoded)

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    if not DASHBOARD_PASSWORD:
        print("=" * 55)
        print("  ERROR: DASHBOARD_PASSWORD is not set.")
        print("  Set it in config.py or via the DASHBOARD_PASSWORD env var.")
        print("=" * 55)
        raise SystemExit(1)
    print("=" * 55)
    print("  TRADING BOT DASHBOARD")
    print("=" * 55)
    print(f"  URL:      http://localhost:{PORT}")
    print(f"  Password: {'*' * 8} (via env/config)")
    print("=" * 55)
    print("  Press Ctrl+C to stop.")
    print()
    server = HTTPServer(("localhost", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDashboard stopped.")
