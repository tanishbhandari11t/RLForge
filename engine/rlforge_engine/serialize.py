"""Conversion of environment values (observations, actions, spaces, info dicts) to JSON-safe data."""

from __future__ import annotations

import math
import numbers
from typing import Any

import numpy as np

MAX_VECTOR = 64
MAX_LIST = 256
MAX_DICT = 100


def num(x: Any) -> Any:
    """Convert a scalar to a JSON-safe number. Non-finite values become strings."""
    try:
        f = float(x)
    except Exception:
        return str(x)
    if math.isnan(f):
        return "NaN"
    if math.isinf(f):
        return "Infinity" if f > 0 else "-Infinity"
    if isinstance(x, (numbers.Integral, np.integer)) and not isinstance(x, (bool, np.bool_)):
        return int(x)
    return f


def summarize_array(arr: np.ndarray) -> dict:
    out: dict[str, Any] = {"shape": list(arr.shape), "dtype": str(arr.dtype)}
    if arr.size == 0 or (not np.issubdtype(arr.dtype, np.number) and arr.dtype != np.bool_):
        return out
    a = arr.astype(np.float64, copy=False)
    nan = np.isnan(a)
    inf = np.isinf(a)
    finite = a[~(nan | inf)]
    out.update(
        nanCount=int(nan.sum()),
        infCount=int(inf.sum()),
        min=num(finite.min()) if finite.size else None,
        max=num(finite.max()) if finite.size else None,
        mean=num(finite.mean()) if finite.size else None,
        std=num(finite.std()) if finite.size else None,
    )
    return out


def sanitize(obj: Any, depth: int = 0) -> Any:
    """Recursively convert arbitrary Python/numpy data into something json.dumps accepts."""
    if depth > 8:
        return repr(obj)[:200]
    if obj is None or isinstance(obj, (bool, str)):
        return obj
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, numbers.Integral):
        return int(obj)
    if isinstance(obj, numbers.Real):
        return num(obj)
    if isinstance(obj, np.ndarray):
        if obj.size <= MAX_VECTOR and obj.dtype != object:
            return sanitize(obj.tolist(), depth + 1)
        return {"__tensor__": summarize_array(obj)}
    if isinstance(obj, np.generic):
        return sanitize(obj.item(), depth + 1)
    if isinstance(obj, dict):
        return {str(k): sanitize(v, depth + 1) for k, v in list(obj.items())[:MAX_DICT]}
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [sanitize(v, depth + 1) for v in list(obj)[:MAX_LIST]]
    return repr(obj)[:200]


def encode_value(x: Any) -> dict:
    """Encode an observation or action into a typed structure the UI knows how to render."""
    if isinstance(x, dict):
        return {"kind": "dict", "items": {str(k): encode_value(v) for k, v in x.items()}}
    if isinstance(x, tuple):
        return {"kind": "tuple", "items": [encode_value(v) for v in x]}
    if isinstance(x, (bool, np.bool_)):
        return {"kind": "scalar", "value": int(bool(x)), "integer": True}
    if isinstance(x, (numbers.Number, np.generic)) and not isinstance(x, np.ndarray):
        return {"kind": "scalar", "value": num(x), "integer": isinstance(x, (numbers.Integral, np.integer))}
    try:
        arr = np.asarray(x)
    except Exception:
        return {"kind": "other", "repr": repr(x)[:300]}
    if arr.dtype == object:
        return {"kind": "other", "repr": repr(x)[:300]}
    if arr.ndim == 0:
        return encode_value(arr.item())
    if arr.size <= MAX_VECTOR:
        return {
            "kind": "vector",
            "shape": list(arr.shape),
            "dtype": str(arr.dtype),
            "values": [num(v) for v in arr.reshape(-1).tolist()],
        }
    return {"kind": "tensor", **summarize_array(arr)}


def _bounds(values: np.ndarray) -> Any:
    if values.size > MAX_VECTOR:
        finite = values[np.isfinite(values)]
        return {"min": num(values.min()), "max": num(values.max()), "allFinite": bool(finite.size == values.size)}
    return [num(v) for v in values.reshape(-1).tolist()]


def describe_space(space: Any) -> dict:
    """Describe a Gymnasium space as JSON."""
    try:
        from gymnasium import spaces
    except Exception:  # pragma: no cover - gymnasium is required for sessions anyway
        return {"type": type(space).__name__, "repr": repr(space)}

    base = {"type": type(space).__name__, "repr": repr(space)[:500]}
    if isinstance(space, spaces.Box):
        low = np.asarray(space.low, dtype=np.float64)
        high = np.asarray(space.high, dtype=np.float64)
        base.update(
            shape=list(space.shape),
            dtype=str(space.dtype),
            low=_bounds(low),
            high=_bounds(high),
            boundedBelow=bool(np.all(np.isfinite(low))),
            boundedAbove=bool(np.all(np.isfinite(high))),
            size=int(np.prod(space.shape)) if space.shape else 1,
        )
    elif isinstance(space, spaces.Discrete):
        base.update(n=int(space.n), start=int(space.start))
    elif isinstance(space, spaces.MultiDiscrete):
        base.update(nvec=[int(v) for v in np.asarray(space.nvec).reshape(-1)], shape=list(space.shape))
    elif isinstance(space, spaces.MultiBinary):
        base.update(n=sanitize(space.n), shape=list(space.shape))
    elif isinstance(space, spaces.Dict):
        base.update(spaces={k: describe_space(v) for k, v in space.spaces.items()})
    elif isinstance(space, spaces.Tuple):
        base.update(spaces=[describe_space(v) for v in space.spaces])
    return base
