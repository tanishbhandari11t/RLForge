"""Agents that drive the environment in the Arena: a random agent and Stable-Baselines3 models."""

from __future__ import annotations

import json
import math
import os
import zipfile
from typing import Any

import numpy as np

from .serialize import num

SB3_ALGOS = ("PPO", "A2C", "DQN", "SAC", "TD3", "DDPG")


class AgentLoadError(Exception):
    pass


def _space_kind(space: Any) -> str:
    from gymnasium import spaces

    if isinstance(space, spaces.Discrete):
        return "discrete"
    if isinstance(space, spaces.Box):
        return "continuous"
    return "other"


def _bounds(space: Any) -> tuple[list, list]:
    low = [num(v) if math.isfinite(float(v)) else None for v in np.asarray(space.low, dtype=np.float64).reshape(-1)]
    high = [num(v) if math.isfinite(float(v)) else None for v in np.asarray(space.high, dtype=np.float64).reshape(-1)]
    return low, high


def _entropy(probs: np.ndarray) -> float:
    p = probs[probs > 0]
    return float(-(p * np.log(p)).sum())


class RandomAgent:
    kind = "random"

    def __init__(self, action_space: Any, seed: int | None):
        self.action_space = action_space
        self.space_kind = _space_kind(action_space)
        if seed is not None:
            action_space.seed(seed)

    def describe(self) -> dict:
        return {"kind": self.kind, "name": "Random agent", "algorithm": None}

    def act(self, obs: Any) -> tuple[Any, dict]:
        action = self.action_space.sample()
        if self.space_kind == "discrete":
            n = int(self.action_space.n)
            probs = np.full(n, 1.0 / n)
            return action, {
                "type": "discrete",
                "mode": "uniform",
                "probs": probs.tolist(),
                "selected": int(action) - int(self.action_space.start),
                "entropy": _entropy(probs),
            }
        if self.space_kind == "continuous":
            low, high = _bounds(self.action_space)
            return action, {
                "type": "continuous",
                "values": [num(v) for v in np.asarray(action, dtype=np.float64).reshape(-1)],
                "low": low,
                "high": high,
            }
        return action, {"type": "other"}

    def reset(self) -> None:
        pass


def detect_sb3_algorithm(path: str) -> str | None:
    """Guess the SB3 algorithm of a saved model from its zip metadata and filename."""
    name = os.path.basename(path).lower()
    for algo in SB3_ALGOS:
        if algo.lower() in name:
            return algo
    try:
        with zipfile.ZipFile(path) as zf:
            data = json.loads(zf.read("data").decode("utf-8"))
        module = str(data.get("policy_class", {}).get("__module__", "")).lower()
        for key, algo in (("dqn", "DQN"), ("sac", "SAC"), ("td3", "TD3"), ("ddpg", "DDPG")):
            if f".{key}." in module:
                return algo
    except Exception:
        pass
    return None


class SB3Agent:
    kind = "sb3"

    def __init__(self, path: str, env: Any, algorithm: str | None, deterministic: bool):
        try:
            import stable_baselines3 as sb3
        except ImportError as exc:
            raise AgentLoadError(
                "stable-baselines3 is not installed in the selected Python interpreter. "
                "Install it with: pip install stable-baselines3"
            ) from exc

        path = os.path.abspath(os.path.expanduser(path))
        if not os.path.isfile(path):
            raise AgentLoadError(f"Model file not found: {path}")

        algo = (algorithm or "").upper() or detect_sb3_algorithm(path)
        candidates = [algo] if algo else ["PPO", "A2C"]
        custom_objects = {"learning_rate": 0.0, "lr_schedule": lambda _: 0.0, "clip_range": lambda _: 0.0}
        last_error: Exception | None = None
        self.model = None
        for name in candidates:
            cls = getattr(sb3, name, None)
            if cls is None:
                continue
            try:
                self.model = cls.load(path, device="cpu", custom_objects=custom_objects)
                self.algorithm = name
                break
            except Exception as exc:
                last_error = exc
        if self.model is None:
            raise AgentLoadError(f"Could not load {os.path.basename(path)} as {'/'.join(candidates)}: {last_error}")

        self.path = path
        self.deterministic = deterministic
        self.action_space = env.action_space
        self.space_kind = _space_kind(env.action_space)
        self._check_compatibility(env)

    def _check_compatibility(self, env: Any) -> None:
        model_obs = getattr(self.model, "observation_space", None)
        env_obs = env.observation_space
        if model_obs is not None and getattr(model_obs, "shape", None) is not None and env_obs.shape is not None:
            if tuple(model_obs.shape) != tuple(env_obs.shape) and sorted(model_obs.shape) != sorted(env_obs.shape):
                raise AgentLoadError(
                    f"Model expects observations of shape {tuple(model_obs.shape)} but the environment "
                    f"produces {tuple(env_obs.shape)}. Was it trained on a different environment or with wrappers?"
                )
        model_act = getattr(self.model, "action_space", None)
        if model_act is not None and type(model_act).__name__ != type(self.action_space).__name__:
            raise AgentLoadError(
                f"Model action space {model_act} is incompatible with environment action space {self.action_space}."
            )

    def describe(self) -> dict:
        return {
            "kind": self.kind,
            "name": os.path.basename(self.path),
            "algorithm": self.algorithm,
            "path": self.path,
            "deterministic": self.deterministic,
        }

    def reset(self) -> None:
        pass

    def act(self, obs: Any) -> tuple[Any, dict]:
        action, _ = self.model.predict(obs, deterministic=self.deterministic)
        info: dict[str, Any] = {"type": self.space_kind}
        try:
            info.update(self._introspect(obs, action))
        except Exception as exc:
            info["introspectionError"] = f"{type(exc).__name__}: {exc}"[:200]

        if self.space_kind == "discrete":
            action = int(np.asarray(action).reshape(-1)[0])
            info["selected"] = action - int(self.action_space.start)
        elif self.space_kind == "continuous":
            action = np.asarray(action, dtype=self.action_space.dtype).reshape(self.action_space.shape)
            low, high = _bounds(self.action_space)
            info.update(values=[num(v) for v in action.astype(np.float64).reshape(-1)], low=low, high=high)
        return action, info

    def _introspect(self, obs: Any, action: Any) -> dict:
        import torch

        policy = self.model.policy
        out: dict[str, Any] = {}
        with torch.no_grad():
            obs_t, _ = policy.obs_to_tensor(obs)
            if self.algorithm == "DQN":
                q = policy.q_net(obs_t)[0].cpu().numpy().astype(np.float64)
                exp = np.exp(q - q.max())
                probs = exp / exp.sum()
                out.update(mode="q", qValues=[num(v) for v in q], probs=probs.tolist(), entropy=_entropy(probs))
            elif hasattr(policy, "get_distribution"):
                dist = policy.get_distribution(obs_t)
                if self.space_kind == "discrete":
                    probs = dist.distribution.probs[0].cpu().numpy().astype(np.float64)
                    out.update(mode="policy", probs=probs.tolist(), entropy=_entropy(probs))
                elif self.space_kind == "continuous":
                    d = dist.distribution
                    out.update(
                        mean=[num(v) for v in d.mean[0].cpu().numpy().reshape(-1)],
                        std=[num(v) for v in d.stddev[0].cpu().numpy().reshape(-1)],
                    )
                if hasattr(policy, "predict_values"):
                    out["value"] = num(policy.predict_values(obs_t)[0].item())
            elif self.algorithm in ("SAC", "TD3", "DDPG") and hasattr(self.model, "critic"):
                act = np.asarray(action, dtype=np.float32).reshape(1, -1)
                scaled = policy.scale_action(act)
                act_t = torch.as_tensor(scaled, device=obs_t.device if hasattr(obs_t, "device") else "cpu")
                qs = self.model.critic(obs_t, act_t)
                out["q"] = num(min(float(q[0].item()) for q in qs))
        return out


def make_agent(config: dict | None, env: Any, seed: int | None):
    config = config or {}
    kind = config.get("kind", "random")
    if kind == "random":
        return RandomAgent(env.action_space, seed)
    if kind == "sb3":
        path = config.get("path")
        if not path:
            raise AgentLoadError("No model file selected.")
        return SB3Agent(path, env, config.get("algorithm"), bool(config.get("deterministic", True)))
    raise AgentLoadError(f"Unknown agent kind: {kind}")
