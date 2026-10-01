"""MetaTrader 5 adapter (Windows + MT5 terminal + `pip install MetaTrader5`)."""
from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timedelta, timezone

from guard import ClosedTrade, Position, Snapshot

log = logging.getLogger("broker")


class MT5Broker:
    def __init__(self, cfg: dict, server_utc_offset_hours: float = 3.0, magic: int = 26092026):
        import MetaTrader5 as mt5     # imported here so the rest of the project runs anywhere
        self.mt5 = mt5
        self.cfg = cfg
        self.offset_s = int(server_utc_offset_hours * 3600)
        self.magic = magic
        self.suffix = cfg.get("symbol_suffix", "")

    # -- connection
    def connect(self):
        m, c = self.mt5, self.cfg
        kw = {k: c[k] for k in ("path",) if c.get(k)}
        if c.get("login"):
            kw.update(login=int(c["login"]), password=c["password"], server=c["server"])
        if not m.initialize(**kw):
            raise RuntimeError(f"MT5 initialize failed: {m.last_error()}")
        ai = m.account_info()
        if ai is None:
            raise RuntimeError("no account info - is the terminal logged in?")
        log.info("connected: login %s, balance %.2f, equity %.2f, %s", ai.login, ai.balance, ai.equity, ai.currency)
        return ai

    def shutdown(self):
        self.mt5.shutdown()

    def resolve(self, symbol: str) -> str:
        sym = symbol + self.suffix
        if not self.mt5.symbol_select(sym, True):
            raise RuntimeError(f"cannot select symbol {sym}")
        return sym

    def check_server_offset(self, symbol: str):
        """Warn if the configured server UTC offset disagrees with a live tick's timestamp."""
        tick = self.mt5.symbol_info_tick(symbol)
        if not tick:
            return
        raw = tick.time - time.time()                       # ~ server offset if the feed is live
        snapped = round(raw / 1800) * 1800
        if abs(raw - snapped) < 120:                        # looks like a live feed
            if abs(snapped - self.offset_s) > 60:
                log.warning("server time offset looks like %+.1fh but config says %+.1fh - "
                            "fix server_utc_offset_hours", snapped / 3600, self.offset_s / 3600)

    def _utc(self, epoch: int) -> datetime:
        return datetime.fromtimestamp(epoch - self.offset_s, tz=timezone.utc)

    # -- state
    def snapshot(self) -> Snapshot:
        ai = self.mt5.account_info()
        if ai is None:
            raise RuntimeError(f"account_info failed: {self.mt5.last_error()}")
        pos = self.mt5.positions_get() or []
        plist = [Position(p.ticket, p.symbol, 1 if p.type == 0 else -1, p.volume,
                          p.profit + p.swap, self._utc(p.time)) for p in pos]
        return Snapshot(datetime.now(timezone.utc), ai.balance, ai.equity, plist)

    def closed_today(self, day_key: str, day_fn):
        """Net closed P&L (incl. commission/swap/fees) for the platform day + list of closed trades."""
        now = datetime.now(timezone.utc)
        deals = self.mt5.history_deals_get(now - timedelta(days=2), now + timedelta(days=2))
        net, trades = 0.0, []
        for d in deals or []:
            if d.type not in (0, 1):            # skip balance/credit operations
                continue
            t = self._utc(d.time)
            if day_fn(t) != day_key:
                continue
            cost = d.profit + d.commission + d.swap + getattr(d, "fee", 0.0)
            net += cost
            if d.entry in (1, 2, 3):            # OUT / INOUT / OUT_BY
                trades.append(ClosedTrade(d.symbol, 1 if d.type == 1 else -1, t, cost))
        return net, trades

    def closed_bars(self, symbol: str, n: int = 1500):
        rates = self.mt5.copy_rates_from_pos(symbol, self.mt5.TIMEFRAME_M15, 0, n)
        if rates is None or len(rates) < 100:
            return None
        return rates[:-1]                        # drop the still-forming bar

    def tick(self, symbol: str):
        """Latest tick, or None if the feed is stale (market closed / disconnected)."""
        t = self.mt5.symbol_info_tick(symbol)
        if t is None or (time.time() + self.offset_s - t.time) > 90:
            return None
        return t

    # -- sizing
    def lots_for_risk(self, symbol: str, risk_money: float, sl_dist: float) -> float:
        si = self.mt5.symbol_info(symbol)
        loss_per_lot = sl_dist / si.trade_tick_size * si.trade_tick_value
        if loss_per_lot <= 0:
            return 0.0
        step = si.volume_step
        lots = math.floor(risk_money / loss_per_lot / step + 1e-9) * step
        lots = min(lots, si.volume_max)
        if lots < si.volume_min:
            return 0.0                           # would need to risk MORE than allowed
        return round(lots, max(0, -int(math.floor(math.log10(step)))))

    def risk_of(self, symbol: str, lots: float, sl_dist: float) -> float:
        si = self.mt5.symbol_info(symbol)
        return lots * sl_dist / si.trade_tick_size * si.trade_tick_value

    # -- orders
    def _fill(self, symbol: str):
        m = self.mt5
        mode = m.symbol_info(symbol).filling_mode
        if mode & 2:
            return m.ORDER_FILLING_IOC
        if mode & 1:
            return m.ORDER_FILLING_FOK
        return m.ORDER_FILLING_RETURN

    def _send(self, req: dict, tries: int = 3):
        m = self.mt5
        for k in range(tries):
            res = m.order_send(req)
            if res is not None and res.retcode == m.TRADE_RETCODE_DONE:
                return res
            code = None if res is None else res.retcode
            log.warning("order_send failed (try %d): retcode=%s last_error=%s", k + 1, code, m.last_error())
            if code in (m.TRADE_RETCODE_REQUOTE, m.TRADE_RETCODE_PRICE_CHANGED, m.TRADE_RETCODE_PRICE_OFF):
                t = m.symbol_info_tick(req["symbol"])
                req["price"] = t.ask if req["type"] == m.ORDER_TYPE_BUY else t.bid
                continue
            time.sleep(0.5)
        return None

    def open(self, symbol: str, direction: int, lots: float, sl: float, tp: float):
        m = self.mt5
        t = m.symbol_info_tick(symbol)
        typ = m.ORDER_TYPE_BUY if direction == 1 else m.ORDER_TYPE_SELL
        req = {"action": m.TRADE_ACTION_DEAL, "symbol": symbol, "volume": lots, "type": typ,
               "price": t.ask if direction == 1 else t.bid, "sl": sl, "tp": tp, "deviation": 15,
               "magic": self.magic, "comment": "fpbot", "type_time": m.ORDER_TIME_GTC,
               "type_filling": self._fill(symbol)}
        res = self._send(req)
        return res.order if res else None

    def close_position(self, pos: Position) -> bool:
        m = self.mt5
        t = m.symbol_info_tick(pos.symbol)
        typ = m.ORDER_TYPE_SELL if pos.direction == 1 else m.ORDER_TYPE_BUY
        req = {"action": m.TRADE_ACTION_DEAL, "symbol": pos.symbol, "volume": pos.volume, "type": typ,
               "position": pos.ticket, "price": t.bid if pos.direction == 1 else t.ask, "deviation": 30,
               "magic": self.magic, "comment": "fpbot close", "type_time": m.ORDER_TIME_GTC,
               "type_filling": self._fill(pos.symbol)}
        return self._send(req, tries=5) is not None

    def close_many(self, positions) -> int:
        return sum(1 for p in positions if self.close_position(p))
