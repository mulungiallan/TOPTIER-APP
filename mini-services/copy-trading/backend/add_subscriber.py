"""
Admin CLI: register a new subscriber and print their API key ONCE.
The plaintext key is never stored — only its hash — so save it now.

Usage:
    python add_subscriber.py "Jane Doe" --lot-multiplier 0.5 --max-lot 0.5 \
        --symbols EURUSD,GBPUSD --daily-loss-limit 200 \
        --equity 10000 --max-risk-pct 2.0 --max-concurrent 20
"""

import argparse
import secrets

from database import Base, engine, SessionLocal
import models
from auth import hash_key


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("name")
    parser.add_argument("--lot-multiplier", type=float, default=1.0)
    parser.add_argument("--max-lot", type=float, default=1.0)
    parser.add_argument("--symbols", default="", help="Comma-separated whitelist, empty = all symbols")
    parser.add_argument("--daily-loss-limit", type=float, default=0.0,
                         help="Account-currency loss per day before new signals are withheld. 0 = disabled")
    # Rule #1: Risk-normalized sizing
    parser.add_argument("--equity", type=float, default=10000.0,
                         help="Subscriber's account equity in USD for risk-normalized sizing")
    parser.add_argument("--max-risk-pct", type=float, default=2.0,
                         help="Max risk per trade as % of equity (Rule #1)")
    # Rule #2: Concurrent trade cap
    parser.add_argument("--max-concurrent", type=int, default=20,
                         help="Max concurrent open trades (Rule #2)")
    # Rule #3: Exposure caps
    parser.add_argument("--max-symbol-exposure-pct", type=float, default=20.0,
                         help="Max per-symbol net exposure as % of equity (Rule #3)")
    parser.add_argument("--max-class-exposure-pct", type=float, default=40.0,
                         help="Max per-asset-class net exposure as % of equity (Rule #3)")
    # Rule #4: Time-based
    parser.add_argument("--weekend-crypto-cap-pct", type=float, default=50.0,
                         help="Weekend crypto cap as % of normal size (Rule #4)")
    parser.add_argument("--news-blackout-minutes", type=int, default=30,
                         help="Minutes before/after major news to block metals/forex (Rule #4)")
    # Rule #5: Circuit breakers
    parser.add_argument("--drawdown-soft-pause-pct", type=float, default=8.0,
                         help="Drawdown % to auto-pause a provider (Rule #5)")
    parser.add_argument("--hard-stop-pct", type=float, default=15.0,
                         help="Account-wide drawdown % to hard-stop all trading (Rule #5)")
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)

    plaintext_key = secrets.token_hex(24)

    db = SessionLocal()
    sub = models.Subscriber(
        name=args.name,
        api_key_hash=hash_key(plaintext_key),
        lot_multiplier=args.lot_multiplier,
        max_lot_size=args.max_lot,
        symbol_whitelist=args.symbols,
        daily_loss_limit=args.daily_loss_limit,
        active=True,
        # Risk management settings
        equity_usd=args.equity,
        max_risk_per_trade_pct=args.max_risk_pct,
        max_concurrent_trades=args.max_concurrent,
        max_symbol_exposure_pct=args.max_symbol_exposure_pct,
        max_asset_class_exposure_pct=args.max_class_exposure_pct,
        weekend_crypto_cap_pct=args.weekend_crypto_cap_pct,
        news_blackout_minutes=args.news_blackout_minutes,
        drawdown_soft_pause_pct=args.drawdown_soft_pause_pct,
        account_wide_hard_stop_pct=args.hard_stop_pct,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    db.close()

    print(f"Created subscriber '{sub.name}' (id={sub.id})")
    print(f"API key (save this now, it will not be shown again): {plaintext_key}")
    print("Give this key to the subscriber to put in their subscriber/.env as SUBSCRIBER_API_KEY")
    print(f"\nRisk settings: equity=${args.equity:.0f}, max_risk={args.max_risk_pct}%, "
          f"max_concurrent={args.max_concurrent}, soft_pause={args.drawdown_soft_pause_pct}%, "
          f"hard_stop={args.hard_stop_pct}%")


if __name__ == "__main__":
    main()
