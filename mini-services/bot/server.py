"""
server.py
---------
TOPTIER trading-bot service - control plane.

Runs one isolated bot instance per linked MetaTrader account as a subprocess.
Each instance owns its workspace under data/instances/<instanceId>/ (generated
config, its own logs, trade log, dashboard snapshot). This service never sees
plaintext broker credentials - it only receives them from the app at start
time and writes them into the instance's config.py on the same machine.

Endpoints (all require `x-bot-service-key`):
  GET    /api/health
  GET    /api/instances
  POST   /api/instances                 create + start an instance
  GET    /api/instances/{id}            live status
  POST   /api/instances/{id}/start      (re)start
  POST   /api/instances/{id}/stop       stop gracefully
  DELETE /api/instances/{id}            stop + delete workspace
  GET    /api/instances/{id}/logs       tail the instance's stdout/stderr log

Run:  uvicorn server:app --host 0.0.0.0 --port 8765
"""

import logging
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import settings
import instance_util

settings.ensure_dirs()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("bot-service")

app = FastAPI(title="TOPTIER Bot Service", version="1.0.0")

# ---------------------------------------------------------------------------
# Instance process registry
# ---------------------------------------------------------------------------


class InstanceProcess:
    def __init__(self, spec: dict):
        self.spec = spec
        self.process: subprocess.Popen | None = None
        self.started_at: float | None = None
        self._lock = threading.Lock()

    @property
    def instance_id(self):
        return self.spec["instanceId"]

    def status(self) -> dict:
        with self._lock:
            running = self.process is not None and self.process.poll() is None
            return {
                "instanceId": self.instance_id,
                "status": "running" if running else "stopped",
                "pid": self.process.pid if self.process and running else None,
                "startedAt": self.started_at,
                "platform": self.spec.get("platform"),
                "login": self.spec.get("login"),
            }


class InstanceManager:
    def __init__(self):
        self._instances: dict[str, InstanceProcess] = {}
        self._lock = threading.Lock()

    def _seed(self):
        """Re-hydrate known instances after a service restart. Subprocesses are
        gone, so every previously-known instance is reported as stopped."""
        if not settings.INSTANCES_DIR.exists():
            return
        for d in settings.INSTANCES_DIR.iterdir():
            if d.is_dir():
                spec = instance_util.load_spec(d.name)
                if spec:
                    self._instances[d.name] = InstanceProcess(spec)

    def get(self, instance_id: str) -> InstanceProcess | None:
        with self._lock:
            return self._instances.get(instance_id)

    def create(self, spec: dict) -> InstanceProcess:
        with self._lock:
            inst = InstanceProcess(spec)
            self._instances[spec["instanceId"]] = inst
            return inst

    def list(self):
        with self._lock:
            return [inst.status() for inst in self._instances.values()]

    def remove(self, instance_id: str):
        with self._lock:
            return self._instances.pop(instance_id, None)


manager = InstanceManager()
manager._seed()


# ---------------------------------------------------------------------------
# Subprocess helpers
# ---------------------------------------------------------------------------


def _spawn(inst: InstanceProcess):
    if inst.process is not None and inst.process.poll() is None:
        return  # already running

    workspace = instance_util.instance_dir(inst.instance_id)
    log_path = workspace / "bot_activity.log"
    log_file = open(log_path, "ab", buffering=0)

    cmd = [
        settings.BOT_PYTHON,
        "-u",
        str(Path(__file__).resolve().parent / "runner.py"),
        inst.instance_id,
    ]
    logger.info("spawning instance %s: %s", inst.instance_id, " ".join(cmd))

    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    inst.process = subprocess.Popen(
        cmd,
        cwd=str(workspace),
        stdout=log_file,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
        env=dict(os.environ),
    )
    inst.started_at = time.time()


def _terminate(inst: InstanceProcess):
    proc = inst.process
    if proc is None or proc.poll() is not None:
        inst.process = None
        return

    try:
        if os.name == "nt":
            # On Windows the bot loop handles KeyboardInterrupt (Ctrl+C).
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            proc.terminate()
    except Exception:
        pass

    try:
        proc.wait(timeout=settings.STOP_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        logger.warning("instance %s did not exit in time, force-killing", inst.instance_id)
        proc.kill()
        proc.wait(timeout=10)
    inst.process = None


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def _check_key(x_bot_service_key: str | None):
    expected = settings.BOT_SERVICE_KEY
    if not expected:
        logger.error("BOT_SERVICE_KEY is not configured - refusing all requests.")
        raise HTTPException(status_code=500, detail="BOT_SERVICE_KEY not configured")
    if x_bot_service_key != expected:
        raise HTTPException(status_code=401, detail="Invalid service key")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class InstanceSpec(BaseModel):
    instanceId: str = Field(min_length=1)
    platform: str = "mt5"          # mt5 | mt4
    login: str = ""
    password: str = ""
    server: str = ""
    terminalPath: str | None = None
    webhookUrl: str = ""
    serviceKey: str = ""
    settings: dict = {}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "toptier-bot", "time": time.time()}


@app.get("/api/instances")
def list_instances(x_bot_service_key: str | None = Header(default=None)):
    _check_key(x_bot_service_key)
    return {"instances": manager.list()}


@app.post("/api/instances")
def create_instance(spec: InstanceSpec, x_bot_service_key: str | None = Header(default=None)):
    _check_key(x_bot_service_key)

    existing = manager.get(spec.instanceId)
    if existing and existing.process is not None and existing.process.poll() is None:
        raise HTTPException(status_code=409, detail="Instance is already running")

    instance_util.save_spec(spec.model_dump())
    inst = manager.create(spec.model_dump())
    _spawn(inst)
    return {"instance": inst.status()}


@app.get("/api/instances/{instance_id}")
def get_instance(instance_id: str, x_bot_service_key: str | None = Header(default=None)):
    _check_key(x_bot_service_key)
    inst = manager.get(instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    return {"instance": inst.status()}


@app.post("/api/instances/{instance_id}/start")
def start_instance(instance_id: str, x_bot_service_key: str | None = Header(default=None)):
    _check_key(x_bot_service_key)
    inst = manager.get(instance_id)
    if inst is None:
        spec = instance_util.load_spec(instance_id)
        if spec is None:
            raise HTTPException(status_code=404, detail="Instance not found")
        inst = manager.create(spec)
    _spawn(inst)
    return {"instance": inst.status()}


@app.post("/api/instances/{instance_id}/stop")
def stop_instance(instance_id: str, x_bot_service_key: str | None = Header(default=None)):
    _check_key(x_bot_service_key)
    inst = manager.get(instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    _terminate(inst)
    return {"instance": inst.status()}


@app.delete("/api/instances/{instance_id}")
def delete_instance(instance_id: str, x_bot_service_key: str | None = Header(default=None)):
    _check_key(x_bot_service_key)
    inst = manager.get(instance_id)
    if inst:
        _terminate(inst)
    manager.remove(instance_id)
    instance_util.delete_workspace(instance_id)
    return {"deleted": True}


@app.get("/api/instances/{instance_id}/logs")
def instance_logs(
    instance_id: str,
    tail: int = settings.MAX_LOG_LINES,
    x_bot_service_key: str | None = Header(default=None),
):
    _check_key(x_bot_service_key)
    log_path = instance_util.instance_dir(instance_id) / "bot_activity.log"
    if not log_path.exists():
        return {"lines": []}
    raw = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    return {"lines": raw[-max(1, min(int(tail), 5000)):]}
