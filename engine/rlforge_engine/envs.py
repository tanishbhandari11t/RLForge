"""Creating environments (registered Gymnasium ids or custom classes in user files) and inspecting them."""

from __future__ import annotations

import hashlib
import importlib.util
import inspect
import os
import sys
from typing import Any

from .known_envs import labels_for
from .serialize import describe_space, encode_value, sanitize

FILE_SPEC_SUFFIXES = (".py:",)


class EnvLoadError(Exception):
    pass


def is_file_spec(spec: str) -> bool:
    return any(s in spec for s in FILE_SPEC_SUFFIXES)


def _load_class_from_file(spec: str):
    path, cls_name = spec.rsplit(":", 1)
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isfile(path):
        raise EnvLoadError(f"Environment file not found: {path}")
    directory = os.path.dirname(path)
    if directory not in sys.path:
        sys.path.insert(0, directory)
    digest = hashlib.sha1(path.encode("utf-8")).hexdigest()[:8]
    module_name = f"rlforge_user_{os.path.splitext(os.path.basename(path))[0]}_{digest}"
    module_spec = importlib.util.spec_from_file_location(module_name, path)
    if module_spec is None or module_spec.loader is None:
        raise EnvLoadError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(module_spec)
    sys.modules[module_name] = module
    module_spec.loader.exec_module(module)
    cls = getattr(module, cls_name, None)
    if cls is None:
        raise EnvLoadError(f"Class '{cls_name}' not found in {path}")
    return cls


def _pick_render_mode(modes: list[str]) -> str | None:
    for preferred in ("rgb_array", "ansi"):
        if preferred in modes:
            return preferred
    return None


def make_env(spec: str, kwargs: dict | None = None):
    """Create an environment that renders off-screen. Returns ``(env, render_mode)``."""
    kwargs = dict(kwargs or {})
    if is_file_spec(spec):
        cls = _load_class_from_file(spec)
        modes = list(getattr(cls, "metadata", {}).get("render_modes", []) or [])
        mode = _pick_render_mode(modes) or "rgb_array"
        try:
            return cls(render_mode=mode, **kwargs), mode
        except TypeError:
            env = cls(**kwargs)
            return env, getattr(env, "render_mode", None)

    try:
        import gymnasium as gym
    except ImportError as exc:
        raise EnvLoadError("gymnasium is not installed in the selected Python interpreter.") from exc

    mode: str | None = "rgb_array"
    try:
        env_spec = gym.spec(spec)
        creator = env_spec.entry_point
        if isinstance(creator, str):
            from gymnasium.envs import registration

            loader = getattr(registration, "load_env_creator", None) or getattr(registration, "load", None)
            creator = loader(creator) if loader else None
        modes = list(getattr(creator, "metadata", {}).get("render_modes", []) or [])
        mode = _pick_render_mode(modes)
    except Exception:
        pass

    if mode is None:
        return gym.make(spec, **kwargs), None
    try:
        return gym.make(spec, render_mode=mode, **kwargs), mode
    except TypeError:
        return gym.make(spec, **kwargs), None


def _wrapper_chain(env: Any) -> list[str]:
    chain = []
    current = env
    for _ in range(32):
        chain.append(type(current).__name__)
        inner = getattr(current, "env", None)
        if inner is None or inner is current:
            break
        current = inner
    return chain


def _source_location(obj: Any) -> tuple[str | None, int | None]:
    try:
        path = inspect.getsourcefile(obj)
        _, line = inspect.getsourcelines(obj)
        return path, line
    except Exception:
        return None, None


def _doc_summary(obj: Any) -> str | None:
    doc = inspect.getdoc(obj)
    if not doc:
        return None
    para = doc.strip().split("\n\n")[0]
    return " ".join(para.split())[:600]


def inspect_env(env: Any, spec: str, render_mode: str | None, kwargs: dict | None = None, seed: int | None = 0) -> dict:
    unwrapped = getattr(env, "unwrapped", env)
    env_cls = type(unwrapped)
    source_file, source_line = _source_location(env_cls)
    metadata = getattr(unwrapped, "metadata", {}) or {}
    labels = labels_for(spec, kwargs)

    spec_info = None
    env_spec = getattr(env, "spec", None)
    if env_spec is not None:
        spec_info = {
            "id": env_spec.id,
            "entryPoint": env_spec.entry_point if isinstance(env_spec.entry_point, str) else repr(env_spec.entry_point),
            "maxEpisodeSteps": env_spec.max_episode_steps,
            "rewardThreshold": env_spec.reward_threshold,
            "nondeterministic": env_spec.nondeterministic,
            "kwargs": sanitize(env_spec.kwargs),
        }

    sample = None
    try:
        obs, _info = env.reset(seed=seed)
        sample = encode_value(obs)
    except Exception as exc:  # surfaced in the inspector instead of failing the whole inspection
        sample = {"kind": "error", "repr": f"reset() raised {type(exc).__name__}: {exc}"}

    reward_range = getattr(unwrapped, "reward_range", None)
    return {
        "envId": spec,
        "source": "file" if is_file_spec(spec) else "registry",
        "envClass": f"{env_cls.__module__}.{env_cls.__qualname__}",
        "description": _doc_summary(env_cls),
        "sourceFile": source_file,
        "sourceLine": source_line,
        "spec": spec_info,
        "observationSpace": describe_space(env.observation_space),
        "actionSpace": describe_space(env.action_space),
        "observationLabels": labels["observation"],
        "actionLabels": labels["action"],
        "renderModes": list(metadata.get("render_modes", []) or []),
        "renderFps": metadata.get("render_fps"),
        "renderMode": render_mode,
        "rewardRange": sanitize(list(reward_range)) if reward_range is not None else None,
        "wrappers": _wrapper_chain(env),
        "sampleObservation": sample,
    }


def list_registered_envs() -> list[dict]:
    import gymnasium as gym

    skip_entry = ("jax", "functional", "phys2d", "tabular", "shimmy")
    out = []
    for env_id, spec in gym.registry.items():
        entry = spec.entry_point if isinstance(spec.entry_point, str) else ""
        if any(s in entry.lower() for s in skip_entry) or env_id.startswith("GymV2"):
            continue
        category = "Other"
        for key, label in (
            ("classic_control", "Classic Control"),
            ("box2d", "Box2D"),
            ("toy_text", "Toy Text"),
            ("mujoco", "MuJoCo"),
            ("ale_py", "Atari"),
        ):
            if key in entry:
                category = label
                break
        out.append({"id": env_id, "category": category})
    out.sort(key=lambda e: (e["category"], e["id"]))
    return out
