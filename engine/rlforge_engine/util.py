"""Helpers shared by sessions, health checks, the fuzzer and recordings."""

from __future__ import annotations

import os
import traceback
from typing import Any

import numpy as np

from .serialize import sanitize

_ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
_STDLIB_DIR = os.path.dirname(os.__file__).lower()


def user_frame(tb: Any) -> dict | None:
    """Deepest traceback frame that lives in user code (not the engine, stdlib or site-packages)."""
    best = None
    for frame in traceback.extract_tb(tb):
        path = os.path.abspath(frame.filename)
        lowered = path.lower()
        if path.startswith(_ENGINE_DIR) or "site-packages" in lowered or "dist-packages" in lowered:
            continue
        if lowered.startswith(_STDLIB_DIR) or frame.filename.startswith("<"):
            continue
        best = {"file": path, "line": frame.lineno, "function": frame.name}
    return best


def exception_info(exc: BaseException) -> dict:
    return {
        "type": type(exc).__name__,
        "message": f"{type(exc).__name__}: {exc}"[:500],
        "traceback": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-6000:],
        "location": user_frame(exc.__traceback__),
    }


def action_to_json(action: Any) -> Any:
    """Exact, replayable representation of an action. Returns None for unsupported (Dict/Tuple) actions."""
    if isinstance(action, np.ndarray):
        return {"nd": sanitize(action.tolist()), "dtype": str(action.dtype)}
    if isinstance(action, (bool, np.bool_)):
        return bool(action)
    if isinstance(action, (int, np.integer)):
        return int(action)
    if isinstance(action, (float, np.floating)):
        return sanitize(float(action))
    return None


def action_from_json(value: Any, space: Any) -> Any:
    if isinstance(value, dict) and "nd" in value:
        dtype = np.dtype(getattr(space, "dtype", None) or value.get("dtype"))
        if np.issubdtype(dtype, np.floating):
            arr = np.asarray(value["nd"], dtype=np.float64).astype(dtype)
        else:
            arr = np.asarray(value["nd"]).astype(dtype)
        shape = getattr(space, "shape", None)
        return arr.reshape(shape) if shape else arr
    if isinstance(value, str):
        return float(value)
    if value is None:
        raise ValueError("This action type cannot be replayed (Dict/Tuple action spaces are not supported yet).")
    from gymnasium import spaces

    if isinstance(space, spaces.Discrete):
        return np.int64(value)
    return value


def flat_obs(obs: Any) -> np.ndarray | None:
    """Flatten an observation to float64 for equality checks; None if not numeric."""
    try:
        if isinstance(obs, dict):
            parts = [flat_obs(obs[k]) for k in sorted(obs)]
        elif isinstance(obs, tuple):
            parts = [flat_obs(v) for v in obs]
        else:
            return np.asarray(obs, dtype=np.float64).reshape(-1)
        if any(p is None for p in parts):
            return None
        return np.concatenate(parts) if parts else np.zeros(0)
    except Exception:
        return None
