FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Build context is this package folder (flat); nest the files into a real
# `trading_signals` package so `uvicorn trading_signals.api:app` resolves.
RUN mkdir -p /app/trading_signals
COPY __init__.py alerts.py api.py backtester.py cash_wallet.py charting.py \
     crypto_wallet.py custody_provider.py data_fetcher.py db.py indicators.py \
     ledger.py main.py news.py notifications.py orders.py payment_provider.py \
     portfolio.py README.md risk.py strategies.py watchlist.py client_demo.html \
     /app/trading_signals/

ENV TRADING_APP_DB=/data/db/trading_app.db
ENV ALERTS_CHECK_INTERVAL_SECONDS=180

EXPOSE 8000

CMD ["sh", "-c", "mkdir -p /data/db && uvicorn trading_signals.api:app --host 0.0.0.0 --port ${PORT:-8000}"]