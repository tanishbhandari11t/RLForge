"""Seeded rollouts with contract checks, reward profiling, deterministic replay and failure minimisation."""

from __future__ import annotations

import math
import random
import time
import warnings
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np

from .anomalies import check_transition
from .util import action_from_json, action_to_json, exception_info, flat_obs

BOUNDARY_PROBABILITY = 0.3


def sample_action(space: Any, rng: np.random.Generator, strategy: str) -> Any:
    """Uniform sample from the space, or (strategy='boundary') sometimes an extreme/edge action."""
    if strategy == "boundary" and rng.random() < BOUNDARY_PROBABILITY:
        from gymnasium import spaces

        if isinstance(space, spaces.Discrete):
            return np.int64(space.start + (space.n - 1 if rng.random() < 0.5 else 0))
        if isinstance(space, spaces.Box):
            low = np.where(np.isfinite(space.low), space.low, -10.0)
            high = np.where(np.isfinite(space.high), space.high, 10.0)
            pick = rng.integers(0, 3, size=space.shape)
            value = np.where(pick == 0, low, np.where(pick == 1, high, np.clip(0.0, low, high)))
            return value.astype(space.dtype)
        if isinstance(space, spaces.MultiDiscrete):
            return np.where(rng.random(space.shape) < 0.5, 0, space.nvec - 1).astype(space.dtype)
        if isinstance(space, spaces.MultiBinary):
            return np.full(space.shape, rng.random() < 0.5, dtype=space.dtype)
    return space.sample()


@dataclass
class Issue:
    level: str
    code: str
    message: str
    step: int
    index: int | None = None
    exception: dict | None = None

    @property
    def signature(self) -> str:
        if self.exception:
            loc = self.exception.get("location") or {}
            return f"exception:{self.exception['type']}:{loc.get('file')}:{loc.get('line')}"
        return f"{self.code}:{self.index}" if self.index is not None else self.code


@dataclass
class EpisodeResult:
    seed: int
    actions: list = field(default_factory=list)
    length: int = 0
    total_reward: float = 0.0
    terminated: bool = False
    truncated: bool = False
    capped: bool = False
    issues: list[Issue] = field(default_factory=list)
    observations: list | None = None
    rewards: list | None = None

    @property
    def crashed(self) -> bool:
        return any(i.exception for i in self.issues)

    @property
    def failed(self) -> bool:
        return any(i.level == "critical" for i in self.issues)

    @property
    def suspicious(self) -> bool:
        return not self.failed and any(i.level == "warning" for i in self.issues)


class RewardProfile:
    """Streaming reward statistics: distribution, sparsity, sign frequency, episode returns."""

    MAX_DISTINCT = 2000
    RESERVOIR = 5000

    def __init__(self, seed: int = 0) -> None:
        self.n = 0
        self.sum = 0.0
        self.sumsq = 0.0
        self.min = math.inf
        self.max = -math.inf
        self.pos = self.neg = self.zero = self.bad = 0
        self.counts: dict[float, int] = {}
        self.overflow = False
        self.sample: list[float] = []
        self.returns: list[float] = []
        self.lengths: list[int] = []
        self._rng = random.Random(seed)

    def add(self, reward: Any) -> None:
        try:
            r = float(reward)
        except Exception:
            self.bad += 1
            return
        if not math.isfinite(r):
            self.bad += 1
            return
        self.n += 1
        self.sum += r
        self.sumsq += r * r
        self.min = min(self.min, r)
        self.max = max(self.max, r)
        if r > 0:
            self.pos += 1
        elif r < 0:
            self.neg += 1
        else:
            self.zero += 1
        if not self.overflow:
            key = round(r, 6)
            self.counts[key] = self.counts.get(key, 0) + 1
            if len(self.counts) > self.MAX_DISTINCT:
                self.overflow = True
                self.counts = {}
        if len(self.sample) < self.RESERVOIR:
            self.sample.append(r)
        else:
            j = self._rng.randrange(self.n)
            if j < self.RESERVOIR:
                self.sample[j] = r

    def end_episode(self, total: float, length: int) -> None:
        if len(self.returns) < 20000:
            self.returns.append(total)
            self.lengths.append(length)

    def result(self) -> dict:
        if self.n == 0:
            return {"steps": 0, "invalid": self.bad}
        mean = self.sum / self.n
        std = math.sqrt(max(self.sumsq / self.n - mean * mean, 0.0))
        out: dict[str, Any] = {
            "steps": self.n,
            "invalid": self.bad,
            "min": self.min,
            "max": self.max,
            "mean": mean,
            "std": std,
            "positive": self.pos / self.n,
            "negative": self.neg / self.n,
            "zero": self.zero / self.n,
        }
        if not self.overflow and self.counts:
            ranked = sorted(self.counts.items(), key=lambda kv: -kv[1])
            out["distinct"] = len(self.counts)
            out["topValues"] = [{"value": v, "count": c, "share": c / self.n} for v, c in ranked[:12]]
            out["sparsity"] = ranked[0][1] / self.n
        else:
            out["distinct"] = None
        if self.max > self.min and (out.get("distinct") is None or out["distinct"] > 12):
            bins = np.histogram(np.asarray(self.sample), bins=24, range=(self.min, self.max))
            out["histogram"] = {"counts": bins[0].tolist(), "edges": bins[1].tolist()}
        if self.returns:
            r = np.asarray(self.returns)
            lengths = np.asarray(self.lengths)
            out["episodes"] = int(r.size)
            out["returnMean"] = float(r.mean())
            out["returnStd"] = float(r.std())
            out["returnMin"] = float(r.min())
            out["returnMax"] = float(r.max())
            out["lengthMean"] = float(lengths.mean())
            out["lengthMax"] = int(lengths.max())
            if r.max() > r.min():
                h = np.histogram(r, bins=20)
                out["returnHistogram"] = {"counts": h[0].tolist(), "edges": h[1].tolist()}
        return out


def _contract_issues(out: Any, step: int) -> tuple[list[Issue], tuple | None]:
    if not isinstance(out, tuple) or len(out) != 5:
        n = len(out) if isinstance(out, tuple) else type(out).__name__
        return [Issue("critical", "step_contract", f"step() returned {n} values; Gymnasium expects "
                      "(obs, reward, terminated, truncated, info)", step)], None
    issues = []
    _obs, _r, term, trunc, info = out
    if not isinstance(term, (bool, np.bool_)) or not isinstance(trunc, (bool, np.bool_)):
        issues.append(Issue("warning", "step_contract",
                            f"terminated/truncated should be bool, got {type(term).__name__}/{type(trunc).__name__}", step))
    if not isinstance(info, dict):
        issues.append(Issue("warning", "step_contract", f"info should be a dict, got {type(info).__name__}", step))
    return issues, out


def run_episode(
    env: Any,
    seed: int,
    max_steps: int,
    strategy: str = "uniform",
    labels: list[str] | None = None,
    actions: list | None = None,
    record: bool = False,
    stop_on: Callable[[Issue], bool] | None = None,
) -> EpisodeResult:
    """Run one seeded episode. If ``actions`` (JSON form) is given they are replayed instead of sampled."""
    labels = labels or []
    result = EpisodeResult(seed=seed)
    if record:
        result.observations, result.rewards = [], []
    rng = np.random.default_rng(seed)
    space = env.action_space
    space.seed(seed)

    def add(issue: Issue) -> bool:
        if not any(i.signature == issue.signature for i in result.issues):
            result.issues.append(issue)
        return bool(stop_on and stop_on(issue))

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            out = env.reset(seed=seed)
        except Exception as exc:
            add(Issue("critical", "exception_reset", f"reset() raised {type(exc).__name__}: {exc}", 0, exception=exception_info(exc)))
            return result
        if not isinstance(out, tuple) or len(out) != 2:
            add(Issue("critical", "reset_contract", "reset() must return (observation, info)", 0))
            return result
        obs = out[0]
        if record:
            result.observations.append(flat_obs(obs))
        for a in check_transition(obs, 0.0, env.observation_space, labels):
            add(Issue(a["level"], a["code"], a["message"], 0, a.get("index")))

        limit = len(actions) if actions is not None else max_steps
        for t in range(limit):
            if actions is not None:
                action = action_from_json(actions[t], space)
            else:
                action = sample_action(space, rng, strategy)
            result.actions.append(action_to_json(action))
            step = t + 1
            try:
                raw = env.step(action)
            except Exception as exc:
                add(Issue("critical", "exception_step", f"step() raised {type(exc).__name__}: {exc}", step,
                          exception=exception_info(exc)))
                result.length = step
                return result
            contract, parsed = _contract_issues(raw, step)
            stop = any([add(i) for i in contract])
            if parsed is None:
                result.length = step
                return result
            obs, reward, terminated, truncated, _info = parsed
            result.length = step
            try:
                result.total_reward += float(reward)
            except Exception:
                pass
            if record:
                result.observations.append(flat_obs(obs))
                result.rewards.append(reward)
            for a in check_transition(obs, reward, env.observation_space, labels):
                stop = add(Issue(a["level"], a["code"], a["message"], step, a.get("index"))) or stop
            if stop:
                return result
            if terminated or truncated:
                result.terminated, result.truncated = bool(terminated), bool(truncated)
                return result
        result.capped = actions is None
    return result


def reproduce(env: Any, seed: int, actions: list, signature: str, labels: list[str]) -> int | None:
    """Replay seed + actions; return the step where ``signature`` occurs, or None if it does not."""
    hit: list[int] = []

    def stop_on(issue: Issue) -> bool:
        if issue.signature == signature:
            hit.append(issue.step)
            return True
        return False

    run_episode(env, seed, len(actions), labels=labels, actions=actions, stop_on=stop_on)
    return hit[0] if hit else None


def minimize(env: Any, seed: int, actions: list, signature: str, labels: list[str],
             budget_s: float = 4.0, max_runs: int = 150) -> list:
    """Delta-debugging: shortest action sequence (same seed) that still triggers ``signature``."""
    deadline = time.perf_counter() + budget_s
    runs = 0
    current = list(actions)
    n = 2
    while len(current) >= 2 and runs < max_runs and time.perf_counter() < deadline:
        chunk = math.ceil(len(current) / n)
        reduced = False
        for i in range(0, len(current), chunk):
            candidate = current[:i] + current[i + chunk:]
            if not candidate:
                continue
            runs += 1
            step = reproduce(env, seed, candidate, signature, labels)
            if step is not None:
                current = candidate[:step]
                n = max(n - 1, 2)
                reduced = True
                break
            if runs >= max_runs or time.perf_counter() >= deadline:
                break
        if not reduced:
            if n >= len(current):
                break
            n = min(len(current), n * 2)
    return current
