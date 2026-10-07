"""Environment fuzzer: thousands of seeded episodes, grouped failures, reproduction and minimisation."""

from __future__ import annotations

import time
from typing import Any, Callable

from .envs import make_env
from .known_envs import labels_for
from .rollout import RewardProfile, minimize, reproduce, run_episode

MAX_GROUPS = 25
MAX_EPISODE_REFS = 20
PROGRESS_INTERVAL = 0.2


def run_fuzz(
    spec: str,
    kwargs: dict | None,
    episodes: int,
    max_steps: int,
    seed: int,
    strategy: str,
    time_budget: float,
    progress: Callable[[dict], None],
    cancelled: Callable[[], bool],
) -> dict:
    env, _ = make_env(spec, kwargs, render=False)
    labels = labels_for(spec, kwargs)["observation"]
    spec_max = getattr(getattr(env, "spec", None), "max_episode_steps", None)
    cap = min(max_steps, spec_max) if spec_max else max_steps
    profile = RewardProfile(seed)
    groups: dict[str, dict] = {}
    totals = {"episodes": 0, "steps": 0, "valid": 0, "suspicious": 0, "failed": 0, "crashed": 0, "capped": 0}
    started = last = time.perf_counter()

    try:
        for i in range(episodes):
            if cancelled() or time.perf_counter() - started > time_budget:
                break
            ep_seed = seed + i
            res = run_episode(env, ep_seed, cap, strategy=strategy, labels=labels, record=True)
            totals["episodes"] += 1
            totals["steps"] += res.length
            totals["capped"] += int(res.capped)
            for r in res.rewards or []:
                profile.add(r)
            profile.end_episode(res.total_reward, res.length)
            if res.failed:
                totals["failed"] += 1
                totals["crashed"] += int(res.crashed)
            elif res.suspicious:
                totals["suspicious"] += 1
            else:
                totals["valid"] += 1

            for issue in res.issues:
                sig = issue.signature
                group = groups.get(sig)
                if group is None:
                    if len(groups) >= MAX_GROUPS:
                        continue
                    group = groups[sig] = {
                        "signature": sig,
                        "code": issue.code,
                        "level": issue.level,
                        "message": issue.message,
                        "exception": issue.exception,
                        "count": 0,
                        "episodes": [],
                        "seed": res.seed,
                        "episode": i + 1,
                        "step": issue.step,
                        "actions": res.actions[: issue.step],
                    }
                group["count"] += 1
                if len(group["episodes"]) < MAX_EPISODE_REFS:
                    group["episodes"].append({"episode": i + 1, "seed": res.seed, "step": issue.step})

            now = time.perf_counter()
            if now - last >= PROGRESS_INTERVAL:
                last = now
                progress({"stage": "Fuzzing", "fraction": (i + 1) / episodes, **totals, "groups": len(groups)})

        ordered = sorted(groups.values(), key=lambda g: (g["level"] != "critical", -g["count"]))
        for n, group in enumerate(ordered):
            if cancelled():
                break
            progress({"stage": f"Reproducing & minimising failure {n + 1}/{len(ordered)}",
                      "fraction": 1.0, **totals, "groups": len(groups)})
            if group["step"] == 0:
                group["reproducible"] = reproduce(env, group["seed"], [], group["signature"], labels) is not None
                group["minimalActions"] = []
                continue
            step = reproduce(env, group["seed"], group["actions"], group["signature"], labels)
            group["reproducible"] = step is not None
            if step is not None and len(group["actions"]) > 1:
                group["minimalActions"] = minimize(env, group["seed"], group["actions"], group["signature"], labels)
            else:
                group["minimalActions"] = group["actions"]

        elapsed = time.perf_counter() - started
        return {
            "envId": spec,
            "seed": seed,
            "strategy": strategy,
            "maxSteps": cap,
            "requestedEpisodes": episodes,
            "totals": totals,
            "seconds": elapsed,
            "stepsPerSecond": totals["steps"] / max(elapsed, 1e-9),
            "cancelled": cancelled(),
            "groups": ordered,
            "rewardProfile": profile.result(),
        }
    finally:
        try:
            env.close()
        except Exception:
            pass
