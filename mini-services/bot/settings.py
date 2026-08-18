"""
settings.py
-----------
Runtime configuration for the TOPTIER bot service (mini-services/bot/server.py).

Everything is env-driven so the service can be deployed next to the Next.js
app (or on a dedicated Windows VPS next to MetaTrader terminals) without code
changes. Secrets are NOT read from this file.
"""

import os
from pathlib import Path

# Repo root = parent of mini-services/  (i.e. <app>)
REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Where the trading engine modules live (mt5_connector.py, main.py, ...).
ENGINE_DIR = Path(os.environ.get("BOT_ENGINE_DIR", str(REPO_ROOT / "mt5_trading_bot")))

# Runtime state: per-instance workspaces + configs. Never commit this folder.
DATA_DIR = Path(os.environ.get("BOT_DATA_DIR", str(Path(__file__).resolve().parent / "data")))
INSTANCES_DIR = DATA_DIR / "instances"

# HTTP service binding.
BOT_SERVICE_HOST = os.environ.get("BOT_SERVICE_HOST", "127.0.0.1")
BOT_SERVICE_PORT = int(os.environ.get("BOT_SERVICE_PORT", "8765"))

# Shared secret the Next.js app sends in `x-bot-service-key` on every request,
# and the engine sends to the app's /api/bot/webhook. Required.
BOT_SERVICE_KEY = os.environ.get("BOT_SERVICE_KEY", "")

# Python interpreter used to launch bot instances. Defaults to the interpreter
# running the service itself. On a Windows VPS, set this to a Python that has
# the MetaTrader5 package installed.
BOT_PYTHON = os.environ.get("BOT_PYTHON", "python")

# How many seconds to wait for an instance process to exit after a stop request
# before force-killing it.
STOP_GRACE_SECONDS = int(os.environ.get("BOT_STOP_GRACE_SECONDS", "15"))

# Maximum lines returned by the logs tail endpoint.
MAX_LOG_LINES = int(os.environ.get("BOT_MAX_LOG_LINES", "200"))


def ensure_dirs():
    INSTANCES_DIR.mkdir(parents=True, exist_ok=True)
