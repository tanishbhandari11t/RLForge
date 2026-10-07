"""An Arena session: one environment + one agent, stepped manually or by a background play loop."""

from __future__ import annotations

import os
import threading
import time
import traceback
from typing import Any, Callable

from .agents import make_agent
from .anomalies import check_transition
from .envs import inspect_env, make_env
from .frames import encode_frame
from .serialize import encode_value, num, sanitize

MAX_UI_FPS = 60.0
END_OF_EPISODE_HOLD = 0.75


def _user_frame(tb: Any) -> dict | None:
    """Deepest traceback frame that lives in user code (not the engine, stdlib or site-packages)."""
    engine_dir = os.path.dirname(os.path.abspath(__file__))
    best = None
    for frame in traceback.extract_tb(tb):
        path = os.path.abspath(frame.filename)
        lowered = path.lower()
        if path.startswith(engine_dir) or "site-packages" in lowered or "dist-packages" in lowered:
            continue
        if os.sep + "lib" + os.sep + "python" in lowered or lowered.startswith(os.path.dirname(os.__file__).lower()):
            continue
        best = {"file": path, "line": frame.lineno, "function": frame.name}
    return best


class Session:
    def __init__(
        self,
        session_id: int,
        emit: Callable[[str, dict], None],
        env_spec: str,
        seed: int | None,
        agent_config: dict | None,
        env_kwargs: dict | None = None,
        auto_reset: bool = True,
    ):
        self.id = session_id
        self._emit = emit
        self.env_spec = env_spec
        self.env, self.render_mode = make_env(env_spec, env_kwargs)
        self.inspection = inspect_env(self.env, env_spec, self.render_mode, env_kwargs, seed)
        self.labels = self.inspection["observationLabels"]
        self.agent = make_agent(agent_config, self.env, seed)

        fps = self.inspection.get("renderFps") or 30
        self.base_fps = float(min(max(fps, 1), 120))
        self.speed = 1.0
        self.auto_reset = auto_reset
        self.base_seed = seed

        self.lock = threading.RLock()
        self.playing = threading.Event()
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._loop, name="rlforge-play", daemon=True)

        self.episode = 0
        self.step_index = 0
        self.total_reward = 0.0
        self.done = False
        self.obs: Any = None
        self.episode_seed: int | None = None
        self.render_failed = False
        self._last_render = 0.0

    # ----------------------------------------------------------------- lifecycle

    def start(self) -> None:
        self.reset()
        self.thread.start()

    def close(self) -> None:
        self.playing.clear()
        self.stopped.set()
        if self.thread.is_alive():
            self.thread.join(timeout=2.0)
        with self.lock:
            try:
                self.env.close()
            except Exception:
                pass

    # ----------------------------------------------------------------- events

    def emit(self, event: str, data: dict) -> None:
        data["sessionId"] = self.id
        self._emit(event, data)

    def status(self) -> dict:
        return {
            "playing": self.playing.is_set(),
            "speed": self.speed,
            "autoReset": self.auto_reset,
            "episode": self.episode,
            "step": self.step_index,
            "done": self.done,
            "baseFps": self.base_fps,
        }

    def emit_status(self) -> None:
        self.emit("status", self.status())

    def _render(self, force: bool) -> dict | None:
        if self.render_mode is None or self.render_failed:
            return None
        now = time.perf_counter()
        if not force and now - self._last_render < 1.0 / MAX_UI_FPS:
            return None
        try:
            frame = encode_frame(self.env.render())
            self._last_render = now
            return frame
        except Exception as exc:
            self.render_failed = True
            self.emit("warning", {"message": f"render() failed, disabling rendering: {type(exc).__name__}: {exc}"})
            return None

    def _fail(self, where: str, exc: BaseException) -> None:
        self.playing.clear()
        self.emit("error", {
            "where": where,
            "message": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
            "location": _user_frame(exc.__traceback__),
        })
        self.emit_status()

    # ----------------------------------------------------------------- stepping

    def reset(self, seed: int | None = None) -> None:
        with self.lock:
            self.episode += 1
            if seed is not None:
                self.episode_seed = seed
            elif self.base_seed is not None:
                self.episode_seed = self.base_seed + self.episode - 1
            else:
                self.episode_seed = None
            try:
                self.obs, info = self.env.reset(seed=self.episode_seed)
            except Exception as exc:
                self._fail("reset", exc)
                return
            self.agent.reset()
            self.step_index = 0
            self.total_reward = 0.0
            self.done = False
            self.emit("reset", {
                "episode": self.episode,
                "seed": self.episode_seed,
                "obs": encode_value(self.obs),
                "info": sanitize(info),
                "frame": self._render(force=True),
                "anomalies": check_transition(self.obs, 0.0, self.env.observation_space, self.labels),
            })

    def step(self) -> bool:
        """Advance one timestep. Returns True if this step ended the episode."""
        with self.lock:
            if self.done:
                if self.auto_reset:
                    self.reset()
                else:
                    self.playing.clear()
                    self.emit_status()
                return False
            if self.obs is None:
                return False
            try:
                action, action_info = self.agent.act(self.obs)
            except Exception as exc:
                self._fail("agent", exc)
                return False
            try:
                obs, reward, terminated, truncated, info = self.env.step(action)
            except Exception as exc:
                self._fail("step", exc)
                return False

            self.step_index += 1
            try:
                self.total_reward += float(reward)
            except Exception:
                pass
            ended = bool(terminated or truncated)
            self.emit("step", {
                "episode": self.episode,
                "step": self.step_index,
                "action": encode_value(action),
                "actionInfo": sanitize(action_info),
                "reward": num(reward),
                "totalReward": num(self.total_reward),
                "terminated": bool(terminated),
                "truncated": bool(truncated),
                "obs": encode_value(obs),
                "info": sanitize(info),
                "frame": self._render(force=ended or not self.playing.is_set()),
                "anomalies": check_transition(obs, reward, self.env.observation_space, self.labels),
            })
            self.obs = obs
            if ended:
                self.done = True
                self.emit("episode_end", {
                    "episode": self.episode,
                    "seed": self.episode_seed,
                    "return": num(self.total_reward),
                    "length": self.step_index,
                    "terminated": bool(terminated),
                    "truncated": bool(truncated),
                })
                if not self.auto_reset:
                    self.playing.clear()
                    self.emit_status()
            return ended

    def _loop(self) -> None:
        while not self.stopped.is_set():
            if not self.playing.wait(0.05):
                continue
            started = time.perf_counter()
            ended = self.step()
            interval = 1.0 / (self.base_fps * self.speed)
            if ended and self.auto_reset:
                interval = max(interval, END_OF_EPISODE_HOLD / max(self.speed, 1.0))
            remaining = interval - (time.perf_counter() - started)
            if remaining > 0:
                self.stopped.wait(remaining)

    # ----------------------------------------------------------------- controls

    def play(self) -> None:
        self.playing.set()
        self.emit_status()

    def pause(self) -> None:
        self.playing.clear()
        with self.lock:
            frame = self._render(force=True)
        if frame:
            self.emit("frame", {"episode": self.episode, "step": self.step_index, "frame": frame})
        self.emit_status()

    def set_speed(self, speed: float) -> None:
        self.speed = float(min(max(speed, 0.05), 20.0))
        self.emit_status()

    def set_auto_reset(self, value: bool) -> None:
        self.auto_reset = bool(value)
        self.emit_status()

    def set_deterministic(self, value: bool) -> None:
        if hasattr(self.agent, "deterministic"):
            self.agent.deterministic = bool(value)
