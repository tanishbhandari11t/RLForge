"""An Arena session: one environment + one agent, stepped manually or by a background play loop."""

from __future__ import annotations

import math
import threading
import time
import traceback
from typing import Any, Callable

from . import recording
from .agents import ReplayFinished, make_agent
from .anomalies import check_transition
from .envs import inspect_env, make_env
from .frames import encode_frame
from .serialize import encode_value, num, sanitize
from .util import action_to_json, user_frame

MAX_UI_FPS = 60.0
END_OF_EPISODE_HOLD = 0.75
MAX_RECORDED_STEPS = 20000


def _divergence(recorded: dict | None, now: dict, labels: list[str]) -> str | None:
    """Compare a recorded encoded observation with the replayed one."""
    if not recorded or recorded.get("kind") != now.get("kind"):
        return None if not recorded else "observation structure differs"
    if now["kind"] == "scalar":
        a, b = recorded.get("value"), now.get("value")
        return None if a == b or (isinstance(a, float) and isinstance(b, float) and math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-9)) else f"value {a} → {b}"
    if now["kind"] == "vector":
        for i, (a, b) in enumerate(zip(recorded.get("values", []), now.get("values", []))):
            if a == b:
                continue
            if isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-9):
                continue
            name = labels[i] if i < len(labels) else f"obs[{i}]"
            return f"{name} recorded {a}, replay gives {b}"
    return None


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
        replay: dict | None = None,
    ):
        self.id = session_id
        self._emit = emit
        self.env_spec = env_spec
        self.env_kwargs = env_kwargs
        self.env, self.render_mode = make_env(env_spec, env_kwargs)
        self.inspection = inspect_env(self.env, env_spec, self.render_mode, env_kwargs, seed)
        self.labels = self.inspection["observationLabels"]
        self.replay = replay
        if replay:
            from .agents import ScriptedAgent

            self.agent = ScriptedAgent(self.env.action_space, replay["actions"], replay.get("infos"),
                                       replay.get("label", "Replay"), replay.get("source", {}))
            seed = replay["seed"]
            auto_reset = False
        else:
            self.agent = make_agent(agent_config, self.env, seed)

        fps = self.inspection.get("renderFps") or 30
        self.base_fps = float(min(max(fps, 1), 120))
        self.speed = 1.0
        self.auto_reset = auto_reset
        self.base_seed = seed
        self.stop_at: int | None = replay.get("stopAt") if replay else None

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
        self.diverged = False

        self.recording = False
        self.ep_initial: dict | None = None
        self.ep_steps: list[dict] = []
        self.ep_anomalies = 0

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
            "recording": self.recording,
            "replay": bool(self.replay),
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
            "location": user_frame(exc.__traceback__),
        })
        self.emit_status()

    # ----------------------------------------------------------------- recording

    def save_episode(self, complete: bool) -> str | None:
        if self.ep_initial is None or self.replay:
            return None
        last = self.ep_steps[-1] if self.ep_steps else {}
        meta = {
            "envId": self.env_spec,
            "kwargs": self.env_kwargs,
            "seed": self.episode_seed,
            "episode": self.episode,
            "agent": self.agent.describe(),
            "return": num(self.total_reward),
            "terminated": bool(last.get("terminated")),
            "truncated": bool(last.get("truncated")),
            "complete": complete,
            "anomalies": self.ep_anomalies,
        }
        path = recording.save(meta, self.ep_initial, self.ep_steps)
        self.emit("episode_saved", {"path": path, "meta": meta})
        return path

    # ----------------------------------------------------------------- stepping

    def reset(self, seed: int | None = None) -> None:
        with self.lock:
            self.episode += 1
            if self.replay:
                self.episode_seed = self.replay["seed"]
            elif seed is not None:
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
            self.diverged = False
            anomalies = check_transition(self.obs, 0.0, self.env.observation_space, self.labels)
            encoded = encode_value(self.obs)
            if self.replay and self.replay.get("initial"):
                diff = _divergence(self.replay["initial"], encoded, self.labels)
                if diff:
                    self.diverged = True
                    anomalies.append({"level": "warning", "code": "replay_divergence",
                                      "message": f"Replay diverged at reset: {diff}. The environment is not deterministic for this seed."})
            self.ep_initial = encoded
            self.ep_steps = []
            self.ep_anomalies = len(anomalies)
            self.emit("reset", {
                "episode": self.episode,
                "seed": self.episode_seed,
                "obs": encoded,
                "info": sanitize(info),
                "frame": self._render(force=True),
                "anomalies": anomalies,
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
            except ReplayFinished:
                self.playing.clear()
                self.done = True
                self.emit("replay_end", {"step": self.step_index, "diverged": self.diverged})
                self.emit_status()
                return False
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
            encoded_obs = encode_value(obs)
            anomalies = check_transition(obs, reward, self.env.observation_space, self.labels)
            if self.replay and not self.diverged:
                expected = self.replay.get("expected") or []
                if self.step_index - 1 < len(expected):
                    rec = expected[self.step_index - 1]
                    diff = _divergence(rec.get("obs"), encoded_obs, self.labels)
                    if diff is None and rec.get("reward") is not None and num(reward) != rec.get("reward"):
                        r0, r1 = rec.get("reward"), num(reward)
                        if not (isinstance(r0, (int, float)) and isinstance(r1, (int, float)) and math.isclose(r0, r1, rel_tol=1e-6, abs_tol=1e-9)):
                            diff = f"reward recorded {r0}, replay gives {r1}"
                    if diff:
                        self.diverged = True
                        anomalies.append({"level": "warning", "code": "replay_divergence",
                                          "message": f"Replay diverged from the recording: {diff}."})
            action_json = sanitize(action_info)
            self.emit("step", {
                "episode": self.episode,
                "step": self.step_index,
                "action": encode_value(action),
                "actionInfo": action_json,
                "reward": num(reward),
                "totalReward": num(self.total_reward),
                "terminated": bool(terminated),
                "truncated": bool(truncated),
                "obs": encoded_obs,
                "info": sanitize(info),
                "frame": self._render(force=ended or not self.playing.is_set() or self.step_index == self.stop_at),
                "anomalies": anomalies,
            })
            self.ep_anomalies += len(anomalies)
            if len(self.ep_steps) < MAX_RECORDED_STEPS:
                self.ep_steps.append({
                    "action": action_to_json(action),
                    "actionInfo": action_json,
                    "reward": num(reward),
                    "terminated": bool(terminated),
                    "truncated": bool(truncated),
                    "obs": encoded_obs,
                })
            self.obs = obs
            if self.stop_at is not None and self.step_index == self.stop_at:
                self.playing.clear()
                self.emit_status()
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
                if self.recording:
                    try:
                        self.save_episode(complete=True)
                    except Exception as exc:
                        self.emit("warning", {"message": f"Could not save episode: {exc}"})
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
        if self.stop_at is not None and self.step_index >= self.stop_at:
            self.stop_at = None
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
        self.auto_reset = bool(value) and not self.replay
        self.emit_status()

    def set_recording(self, value: bool) -> None:
        self.recording = bool(value) and not self.replay
        self.emit_status()

    def set_deterministic(self, value: bool) -> None:
        if hasattr(self.agent, "deterministic"):
            self.agent.deterministic = bool(value)
