"""
runner.py
---------
Process entrypoint for ONE bot instance. The service (server.py) spawns
`python runner.py <instanceId>` as a subprocess; this script:

  1. loads the instance spec (data/instances/<id>/instance.json),
  2. generates the instance's config.py (credentials + settings overrides),
  3. for MT4 instances, installs the MT4 bridge connector as mt5_connector.py
     so the engine can import it unchanged,
  4. puts the instance workspace at the FRONT of sys.path so every
     `import config` resolves to the per-instance file,
  5. imports the engine and runs main.main().

Anything the engine prints goes to stdout/stderr, which the service captures
into data/instances/<id>/bot_activity.log.
"""

import os
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import settings  # noqa: E402
import instance_util  # noqa: E402


def _install_mt4_connector(workspace: Path):
    """MT4 has no Python API, so we shim the engine's `import mt5_connector`
    with the TCP bridge client. The bridge talks to the ToptierBridge.mq4 EA
    running inside the user's MT4 terminal (see mt4_bridge/README)."""
    bridge = Path(__file__).resolve().parent / "mt4_bridge" / "mt4_connector.py"
    if not bridge.exists():
        raise RuntimeError("MT4 bridge connector not found: mt4_bridge/mt4_connector.py")
    source = bridge.read_text(encoding="utf-8")
    (workspace / "mt5_connector.py").write_text(
        "# Generated MT4 bridge shim - lets the engine's `import mt5_connector`\n"
        "# resolve to the TCP client that talks to ToptierBridge.mq4.\n"
        + source,
        encoding="utf-8",
    )


def _report(event: str, payload: dict, instance_id: str, workspace: Path):
    """Best-effort lifecycle report straight to the app webhook. Never raises."""
    try:
        import reporter
        reporter.report_event(event, payload)
    except Exception:
        try:
            # Fall back to a direct POST if reporter can't import for any reason.
            import json
            import urllib.request
            import config
            body = json.dumps({
                "instanceId": instance_id,
                "type": "lifecycle",
                "event": event,
                "data": payload,
            }).encode("utf-8")
            req = urllib.request.Request(
                config.WEBHOOK_URL, data=body, method="POST",
                headers={"Content-Type": "application/json",
                         "x-bot-service-key": config.BOT_SERVICE_KEY},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass


def main():
    if len(sys.argv) < 2:
        print("usage: runner.py <instanceId>", file=sys.stderr)
        return 2

    instance_id = sys.argv[1]
    spec = instance_util.load_spec(instance_id)
    if spec is None:
        print(f"no spec found for instance {instance_id}", file=sys.stderr)
        return 1

    workspace = instance_util.instance_dir(instance_id)

    # 1 + 2: generate the instance config.py
    instance_util.write_config(spec, workspace / "config.py")

    # 3: MT4 bridge shim (only for MT4 accounts)
    if spec.get("platform") == "mt4":
        _install_mt4_connector(workspace)

    # 4: instance workspace first in sys.path, engine second.
    os.chdir(workspace)
    sys.path.insert(0, str(workspace))
    sys.path.insert(1, str(settings.ENGINE_DIR))

    _report("starting", {"platform": spec.get("platform"), "message": "bot instance starting"}, instance_id, workspace)

    try:
        import main
        main.main()
        _report("stopped", {"message": "bot exited cleanly"}, instance_id, workspace)
        return 0
    except KeyboardInterrupt:
        print("runner: interrupted by user")
        _report("stopped", {"message": "bot stopped by user"}, instance_id, workspace)
        return 0
    except SystemExit as exc:
        code = int(exc.code or 0)
        if code != 0:
            _report("error", {"message": f"bot exited with code {code}"}, instance_id, workspace)
        return code
    except Exception:
        traceback.print_exc()
        _report("error", {"message": traceback.format_exc()[-2000:]}, instance_id, workspace)
        return 1


if __name__ == "__main__":
    sys.exit(main())
