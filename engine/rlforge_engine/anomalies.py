"""Per-transition health checks: NaN/Inf values, space violations and exploding rewards."""

from __future__ import annotations

import math
from typing import Any

import numpy as np

EXPLODING_REWARD = 1e6
EXPLODING_OBS = 1e8


def _label(labels: list[str], index: int) -> str:
    return labels[index] if index < len(labels) else f"obs[{index}]"


def _check_array(name: str, arr: np.ndarray, labels: list[str], issues: list[dict]) -> None:
    if not np.issubdtype(arr.dtype, np.number):
        return
    flat = arr.astype(np.float64, copy=False).reshape(-1)
    nan_idx = np.flatnonzero(np.isnan(flat))
    if nan_idx.size:
        issues.append({
            "level": "critical",
            "code": "nan_observation",
            "message": f"NaN in {name} at {_label(labels, int(nan_idx[0]))}"
            + (f" (+{nan_idx.size - 1} more)" if nan_idx.size > 1 else ""),
            "index": int(nan_idx[0]),
        })
    inf_idx = np.flatnonzero(np.isinf(flat))
    if inf_idx.size:
        issues.append({
            "level": "critical",
            "code": "inf_observation",
            "message": f"Inf in {name} at {_label(labels, int(inf_idx[0]))}",
            "index": int(inf_idx[0]),
        })
    finite = flat[np.isfinite(flat)]
    if finite.size and np.max(np.abs(finite)) > EXPLODING_OBS:
        idx = int(np.flatnonzero(np.abs(flat) == np.max(np.abs(finite)))[0])
        issues.append({
            "level": "warning",
            "code": "exploding_observation",
            "message": f"Very large value in {name} at {_label(labels, idx)}: {flat[idx]:.3g}",
            "index": idx,
        })


def _check_box(obs: Any, space: Any, labels: list[str], issues: list[dict]) -> None:
    arr = np.asarray(obs)
    if arr.shape != space.shape:
        issues.append({
            "level": "critical",
            "code": "shape_mismatch",
            "message": f"Observation shape {tuple(arr.shape)} does not match observation_space shape {space.shape}",
        })
        return
    if np.issubdtype(arr.dtype, np.number) and not np.can_cast(arr.dtype, space.dtype):
        issues.append({
            "level": "warning",
            "code": "dtype_mismatch",
            "message": f"Observation dtype {arr.dtype} cannot be safely cast to observation_space dtype {space.dtype}",
        })
    with np.errstate(invalid="ignore"):
        below = np.flatnonzero((arr < space.low).reshape(-1))
        above = np.flatnonzero((arr > space.high).reshape(-1))
    if below.size or above.size:
        idx = int((below if below.size else above)[0])
        flat = arr.reshape(-1)
        bound = space.low.reshape(-1)[idx] if below.size else space.high.reshape(-1)[idx]
        issues.append({
            "level": "warning",
            "code": "out_of_bounds",
            "message": f"{_label(labels, idx)} = {float(flat[idx]):.4g} is outside observation_space "
            f"({'below low' if below.size else 'above high'} {float(bound):.4g})",
            "index": idx,
        })


def check_transition(obs: Any, reward: Any, observation_space: Any, labels: list[str]) -> list[dict]:
    issues: list[dict] = []

    try:
        r = float(reward)
        if math.isnan(r):
            issues.append({"level": "critical", "code": "nan_reward", "message": "Reward is NaN"})
        elif math.isinf(r):
            issues.append({"level": "critical", "code": "inf_reward", "message": "Reward is infinite"})
        elif abs(r) > EXPLODING_REWARD:
            issues.append({"level": "warning", "code": "exploding_reward", "message": f"Very large reward: {r:.3g}"})
    except Exception:
        issues.append({"level": "critical", "code": "invalid_reward", "message": f"Reward is not a number: {reward!r}"[:200]})

    try:
        from gymnasium import spaces

        if isinstance(observation_space, spaces.Box):
            _check_array("observation", np.asarray(obs), labels, issues)
            _check_box(obs, observation_space, labels, issues)
        elif isinstance(obs, np.ndarray):
            _check_array("observation", obs, labels, issues)
            if not observation_space.contains(obs):
                issues.append({"level": "warning", "code": "not_in_space", "message": "Observation is not contained in observation_space"})
        elif not isinstance(observation_space, (spaces.Dict, spaces.Tuple)):
            if not observation_space.contains(obs):
                issues.append({"level": "warning", "code": "not_in_space", "message": f"Observation {obs!r} is not contained in observation_space"[:200]})
    except Exception:
        pass

    return issues
