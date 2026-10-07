"""Episode recordings stored as JSON Lines in <workspace>/.rlforge/episodes.

Line 1 is metadata, line 2 the initial observation, then one line per step. Replays re-simulate the
environment from the seed + recorded actions and compare against the recorded observations/rewards.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

from .serialize import sanitize

RECORD_DIR = os.path.join(".rlforge", "episodes")
MAX_LIST = 300


def record_dir() -> str:
    return os.path.abspath(RECORD_DIR)


def _safe(name: str) -> str:
    base = os.path.basename(name.replace(":", "_"))
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", base)[:60] or "env"


def save(meta: dict, initial: dict, steps: list[dict]) -> str:
    os.makedirs(record_dir(), exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = os.path.join(record_dir(), f"{_safe(meta['envId'])}-ep{meta['episode']}-{stamp}.jsonl")
    meta = {**meta, "version": 1, "createdAt": time.time(), "length": len(steps)}
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(sanitize(meta), allow_nan=False) + "\n")
        f.write(json.dumps(sanitize(initial), allow_nan=False) + "\n")
        for s in steps:
            f.write(json.dumps(sanitize(s), allow_nan=False, separators=(",", ":")) + "\n")
    return path


def list_recordings() -> list[dict]:
    directory = record_dir()
    if not os.path.isdir(directory):
        return []
    files = [os.path.join(directory, f) for f in os.listdir(directory) if f.endswith(".jsonl")]
    files.sort(key=os.path.getmtime, reverse=True)
    out = []
    for path in files[:MAX_LIST]:
        try:
            with open(path, encoding="utf-8") as f:
                meta = json.loads(f.readline())
            out.append({**meta, "path": path, "size": os.path.getsize(path)})
        except Exception:
            continue
    return out


def load(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        meta = json.loads(f.readline())
        initial = json.loads(f.readline())
        steps = [json.loads(line) for line in f if line.strip()]
    return {"meta": meta, "initial": initial, "steps": steps}


def delete(path: str) -> None:
    path = os.path.abspath(path)
    if not path.startswith(record_dir()) or not path.endswith(".jsonl"):
        raise ValueError("Refusing to delete a file outside .rlforge/episodes")
    os.remove(path)
