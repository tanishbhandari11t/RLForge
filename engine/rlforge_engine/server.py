"""Newline-delimited JSON server over stdin/stdout.

Requests:  {"id": 1, "cmd": "load", "args": {...}}
Responses: {"id": 1, "ok": true, "result": {...}}  or  {"id": 1, "ok": false, "error": "...", "traceback": "..."}
Events:    {"event": "step", "data": {...}}
"""

from __future__ import annotations

import json
import os
import platform
import sys
import threading
import traceback
from importlib import metadata
from typing import Any, Callable

from . import __version__
from .serialize import sanitize


class Channel:
    """Writes protocol messages to the real stdout. Anything else printed goes to stderr."""

    def __init__(self) -> None:
        fd = os.dup(1)
        self._out = open(fd, "w", encoding="utf-8", newline="\n", buffering=1)
        os.dup2(2, 1)
        sys.stdout = sys.stderr
        self._lock = threading.Lock()

    def send(self, message: dict) -> None:
        line = json.dumps(sanitize(message), separators=(",", ":"), allow_nan=False)
        with self._lock:
            self._out.write(line + "\n")
            self._out.flush()


def _package_version(*names: str) -> str | None:
    for name in names:
        try:
            return metadata.version(name)
        except metadata.PackageNotFoundError:
            continue
    return None


class Server:
    def __init__(self, channel: Channel) -> None:
        self.channel = channel
        self.session = None
        self.next_session_id = 1
        self._after_response: Callable[[], None] | None = None
        self.handlers: dict[str, Callable[[dict], Any]] = {
            "hello": self.hello,
            "list_envs": self.list_envs,
            "inspect": self.inspect,
            "load": self.load,
            "unload": self.unload,
            "play": lambda a: self._with_session(lambda s: s.play()),
            "pause": lambda a: self._with_session(lambda s: s.pause()),
            "step": self.step,
            "reset": lambda a: self._with_session(lambda s: s.reset(a.get("seed"))),
            "set_speed": lambda a: self._with_session(lambda s: s.set_speed(float(a["speed"]))),
            "set_auto_reset": lambda a: self._with_session(lambda s: s.set_auto_reset(bool(a["value"]))),
            "set_deterministic": lambda a: self._with_session(lambda s: s.set_deterministic(bool(a["value"]))),
            "status": lambda a: self._with_session(lambda s: s.status()),
            "set_recording": lambda a: self._with_session(lambda s: s.set_recording(bool(a["value"]))),
            "save_episode": lambda a: self._with_session(lambda s: s.save_episode(complete=bool(s.done))),
            "list_recordings": self.list_recordings,
            "delete_recording": self.delete_recording,
            "start_health": self.start_health,
            "start_fuzz": self.start_fuzz,
            "cancel_job": self.cancel_job,
        }
        self.jobs: dict[int, threading.Event] = {}
        self.next_job_id = 1

    def emit(self, event: str, data: dict) -> None:
        self.channel.send({"event": event, "data": data})

    # ----------------------------------------------------------------- handlers

    def hello(self, args: dict) -> dict:
        return {
            "engineVersion": __version__,
            "python": platform.python_version(),
            "executable": sys.executable,
            "platform": platform.platform(),
            "cwd": os.getcwd(),
            "packages": {
                "gymnasium": _package_version("gymnasium"),
                "numpy": _package_version("numpy"),
                "stable-baselines3": _package_version("stable-baselines3", "stable_baselines3"),
                "torch": _package_version("torch"),
                "pillow": _package_version("pillow", "Pillow"),
                "pygame": _package_version("pygame", "pygame-ce"),
                "box2d": _package_version("box2d", "box2d-py", "Box2D"),
            },
        }

    def list_envs(self, args: dict) -> list:
        from .envs import list_registered_envs

        return list_registered_envs()

    def inspect(self, args: dict) -> dict:
        env_id = args["env"]
        if self.session is not None and self.session.env_spec == env_id and not args.get("kwargs"):
            return self.session.inspection
        from .envs import inspect_env, make_env

        env, mode = make_env(env_id, args.get("kwargs"))
        try:
            return inspect_env(env, env_id, mode, args.get("kwargs"), args.get("seed", 0))
        finally:
            try:
                env.close()
            except Exception:
                pass

    def load(self, args: dict) -> dict:
        from .session import Session

        self.unload({})
        env_id, kwargs, replay = args.get("env"), args.get("kwargs"), None
        if args.get("replay"):
            replay = self._replay_config(args["replay"])
            env_id, kwargs = replay["env"], replay["kwargs"]
        session_id = self.next_session_id
        self.next_session_id += 1
        session = Session(
            session_id,
            self.emit,
            env_id,
            args.get("seed"),
            args.get("agent"),
            kwargs,
            bool(args.get("autoReset", True)),
            replay=replay,
        )
        self.session = session
        if "speed" in args:
            session.speed = float(args["speed"])
        session.recording = bool(args.get("record")) and replay is None
        result = {
            "sessionId": session_id,
            "envId": env_id,
            "inspection": session.inspection,
            "agent": session.agent.describe(),
            "status": session.status(),
            "replay": None if replay is None else {
                "label": replay["label"],
                "seed": replay["seed"],
                "steps": len(replay["actions"]),
                "stopAt": replay.get("stopAt"),
                "source": replay["source"],
            },
        }
        # The first reset event must follow the response so the UI knows the session id.
        self._after_response = lambda: self._start_session(session)
        return result

    def _replay_config(self, spec: dict) -> dict:
        """Normalise a replay request: a saved recording ({path}) or a seed + action sequence."""
        if spec.get("path"):
            from . import recording

            data = recording.load(spec["path"])
            meta, steps = data["meta"], data["steps"]
            actions = [s.get("action") for s in steps]
            if any(a is None for a in actions):
                raise ValueError("This recording uses an action space RLForge cannot replay (Dict/Tuple actions).")
            name = os.path.basename(spec["path"])
            return {
                "env": meta["envId"],
                "kwargs": meta.get("kwargs"),
                "seed": meta.get("seed"),
                "actions": actions,
                "infos": [s.get("actionInfo") for s in steps],
                "expected": steps,
                "initial": data["initial"],
                "stopAt": spec.get("stopAt"),
                "label": f"Recording · {meta['envId']} episode {meta.get('episode')}",
                "source": {"kind": "recording", "path": spec["path"], "name": name, "meta": meta},
            }
        actions = spec.get("actions") or []
        return {
            "env": spec["env"],
            "kwargs": spec.get("kwargs"),
            "seed": spec.get("seed"),
            "actions": actions,
            "infos": None,
            "expected": None,
            "initial": None,
            "stopAt": spec.get("stopAt") or (len(actions) or None),
            "label": spec.get("label") or "Replay",
            "source": {"kind": spec.get("kind", "sequence"), "signature": spec.get("signature")},
        }

    # ----------------------------------------------------------------- recordings

    def list_recordings(self, args: dict) -> dict:
        from . import recording

        return {"directory": recording.record_dir(), "recordings": recording.list_recordings()}

    def delete_recording(self, args: dict) -> None:
        from . import recording

        recording.delete(args["path"])

    # ----------------------------------------------------------------- background jobs

    def _start_job(self, kind: str, work: Callable[[Callable[[dict], None], Callable[[], bool]], Any]) -> dict:
        job_id = self.next_job_id
        self.next_job_id += 1
        cancel = threading.Event()
        self.jobs[job_id] = cancel

        def progress(data: dict) -> None:
            self.emit("job_progress", {"jobId": job_id, "kind": kind, **data})

        def run() -> None:
            try:
                result = work(progress, cancel.is_set)
                self.emit("job_done", {"jobId": job_id, "kind": kind, "result": result})
            except Exception as exc:
                from .util import exception_info

                self.emit("job_failed", {"jobId": job_id, "kind": kind, **exception_info(exc),
                                         "error": f"{type(exc).__name__}: {exc}"})
            finally:
                self.jobs.pop(job_id, None)

        threading.Thread(target=run, name=f"rlforge-{kind}-{job_id}", daemon=True).start()
        return {"jobId": job_id, "kind": kind}

    def start_health(self, args: dict) -> dict:
        from .health import run_health

        spec, kwargs = args["env"], args.get("kwargs")
        seed = int(args.get("seed", 0))
        steps = int(args.get("stepBudget", 5000))
        seconds = float(args.get("timeBudget", 30))
        return self._start_job("health", lambda p, c: run_health(spec, kwargs, seed, steps, seconds, p, c))

    def start_fuzz(self, args: dict) -> dict:
        from .fuzz import run_fuzz

        spec, kwargs = args["env"], args.get("kwargs")
        episodes = int(args.get("episodes", 1000))
        max_steps = int(args.get("maxSteps", 1000))
        seed = int(args.get("seed", 0))
        strategy = str(args.get("strategy", "uniform"))
        seconds = float(args.get("timeBudget", 300))
        return self._start_job("fuzz", lambda p, c: run_fuzz(spec, kwargs, episodes, max_steps, seed, strategy, seconds, p, c))

    def cancel_job(self, args: dict) -> None:
        event = self.jobs.get(int(args["jobId"]))
        if event is not None:
            event.set()

    def _start_session(self, session: Any) -> None:
        if self.session is session:
            session.start()
            session.emit_status()

    def unload(self, args: dict) -> None:
        if self.session is not None:
            self.session.close()
            self.session = None

    def step(self, args: dict) -> None:
        def run(s: Any) -> None:
            if s.playing.is_set():
                s.playing.clear()
            for _ in range(max(1, int(args.get("count", 1)))):
                s.step()
            s.emit_status()

        self._with_session(run)

    def _with_session(self, fn: Callable[[Any], Any]) -> Any:
        if self.session is None:
            raise RuntimeError("No environment loaded. Launch an environment in the Arena first.")
        return fn(self.session)

    # ----------------------------------------------------------------- dispatch

    def handle(self, message: dict) -> None:
        req_id = message.get("id")
        cmd = message.get("cmd")
        handler = self.handlers.get(cmd)
        if handler is None:
            self.channel.send({"id": req_id, "ok": False, "error": f"Unknown command: {cmd}"})
            return
        self._after_response = None
        try:
            result = handler(message.get("args") or {})
            self.channel.send({"id": req_id, "ok": True, "result": result})
        except Exception as exc:
            self.channel.send({
                "id": req_id,
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc(),
            })
            return
        after, self._after_response = self._after_response, None
        if after is not None:
            after()

    def serve(self) -> None:
        self.emit("ready", {"engineVersion": __version__})
        for raw in sys.stdin:
            raw = raw.strip()
            if not raw:
                continue
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if message.get("cmd") == "shutdown":
                break
            self.handle(message)
        for event in list(self.jobs.values()):
            event.set()
        self.unload({})


def main() -> None:
    os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
    os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    cwd = os.getcwd()
    if cwd not in sys.path:
        sys.path.insert(0, cwd)
    channel = Channel()
    Server(channel).serve()
