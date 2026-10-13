"""
terminal_pool.py
----------------
Multi-tenant MetaTrader terminal pool.

MetaTrader5 is a Windows-only, single-session desktop terminal: one install can
be logged into exactly one broker account at a time. To let many users' accounts
trade concurrently on one Windows host, each bot instance is given its OWN
terminal install (a "slot") and launched in portable mode so the instances do
not share a data directory.

A slot is a directory that contains terminal64.exe (or terminal.exe). The pool
lives in BOT_TERMINAL_POOL_DIR (settings.TERMINAL_POOL_DIR), typically C:\\MT5,
with one subfolder per slot (term01, term02, ...). Allocations are persisted to
DATA_DIR/terminal_pool.json so an instance keeps the same terminal across service
restarts; the current instance specs are also consulted, so a lost state file
cannot hand one terminal to two instances.

When no pool directory is configured the pool is disabled and every instance
falls back to the app-supplied terminalPath (single-machine / developer use).
"""

import json
import os
import threading
from pathlib import Path

import settings

_lock = threading.RLock()


def pool_dir() -> Path:
    """Directory holding the terminal slots, or an empty Path when unset."""
    configured = settings.TERMINAL_POOL_DIR
    return Path(configured) if configured else Path()


def is_enabled() -> bool:
    """True only when the pool is switched on AND a directory is configured."""
    return bool(settings.TERMINAL_POOL_ENABLED and settings.TERMINAL_POOL_DIR)


def discover() -> list[str]:
    """Return the paths of every usable terminal slot, sorted by name.

    A slot is any immediate sub-directory of the pool that contains a terminal
    executable. The pool root itself is also accepted so a single-terminal pool
    works without a sub-folder.
    """
    root = pool_dir()
    if not root or not root.is_dir():
        return []

    def _has_exe(d: Path) -> bool:
        return (d / "terminal64.exe").exists() or (d / "terminal.exe").exists()

    slots = [str(d) for d in sorted(root.iterdir()) if d.is_dir() and _has_exe(d)]
    if not slots and _has_exe(root):
        slots = [str(root)]
    return slots


def _state_path() -> Path:
    return Path(settings.DATA_DIR) / "terminal_pool.json"


def _load_state() -> dict:
    p = _state_path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_state(state: dict) -> None:
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _spec_assignments() -> dict[str, str]:
    """Terminal paths already recorded on existing instance specs.

    Trusting the specs as well as the state file means a wiped/missing
    terminal_pool.json cannot cause two instances to be handed the same slot.
    """
    out: dict[str, str] = {}
    root = Path(settings.INSTANCES_DIR)
    if not root.exists():
        return out
    for d in root.iterdir():
        if not d.is_dir():
            continue
        spec_file = d / "instance.json"
        if not spec_file.exists():
            continue
        try:
            spec = json.loads(spec_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        terminal = spec.get("terminalPath")
        if terminal:
            out[d.name] = str(terminal)
    return out


def allocate(instance_id: str) -> str | None:
    """Reserve a terminal slot for `instance_id` and return its path.

    Returns the instance's previous slot if it still exists, otherwise the first
    free slot. Returns None when the pool is disabled, empty, or fully used.
    """
    if not is_enabled():
        return None
    slots = discover()
    if not slots:
        return None
    with _lock:
        state = _load_state()
        existing = state.get(instance_id)
        if existing and existing in slots:
            return existing

        used = set(state.values())
        used.update(_spec_assignments().values())
        for slot in slots:
            if slot not in used:
                state[instance_id] = slot
                _save_state(state)
                return slot
        return None


def release(instance_id: str) -> None:
    """Return an instance's slot to the pool (called when it is deleted)."""
    with _lock:
        state = _load_state()
        if state.pop(instance_id, None) is not None:
            _save_state(state)


def assigned(instance_id: str) -> str | None:
    return _load_state().get(instance_id)


def summary() -> dict:
    """Human-readable pool state for the health endpoint / operator."""
    slots = discover()
    with _lock:
        used = set(_load_state().values())
        used.update(_spec_assignments().values())
    assigned = [s for s in slots if s in used]
    return {
        "enabled": is_enabled(),
        "dir": str(pool_dir()) if settings.TERMINAL_POOL_DIR else "",
        "total": len(slots),
        "assigned": len(assigned),
        "free": len(slots) - len(assigned),
    }
