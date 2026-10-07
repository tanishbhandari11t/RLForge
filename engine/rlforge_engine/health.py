"""Environment Health: an explainable checklist of contract, space, determinism and reward checks."""

from __future__ import annotations

import inspect as pyinspect
import re
import time
import warnings
from typing import Any, Callable

import numpy as np

from .anomalies import check_transition
from .envs import inspect_env, make_env
from .frames import encode_frame
from .known_envs import labels_for
from .rollout import Issue, RewardProfile, run_episode
from .util import exception_info, flat_obs

CRITICAL_CHECKS = {"construct", "reset_contract", "step_contract", "observation_space", "nan_inf", "determinism", "crashes"}


def _check(cid: str, title: str, status: str, detail: str, **extra: Any) -> dict:
    return {"id": cid, "title": title, "status": status, "detail": detail, **extra}


def _evidence(result: Any, issue: Issue, episode: int) -> dict:
    return {
        "seed": result.seed,
        "episode": episode,
        "step": issue.step,
        "actions": result.actions[: issue.step],
        "signature": issue.signature,
    }


def score(checks: list[dict]) -> int:
    total = got = 0.0
    for c in checks:
        if c["status"] in ("info", "skip"):
            continue
        w = 2.0 if c["id"] in CRITICAL_CHECKS else 1.0
        total += w
        got += w * {"pass": 1.0, "warn": 0.5}.get(c["status"], 0.0)
    return int(round(100 * got / total)) if total else 0


def run_health(
    spec: str,
    kwargs: dict | None,
    seed: int,
    step_budget: int,
    time_budget: float,
    progress: Callable[[dict], None],
    cancelled: Callable[[], bool],
) -> dict:
    started = time.perf_counter()
    checks: list[dict] = []
    report: dict[str, Any] = {"envId": spec, "seed": seed, "checks": checks}

    def emit(stage: str, fraction: float) -> None:
        progress({"stage": stage, "fraction": round(fraction, 3)})

    emit("Creating environment", 0.02)
    try:
        env, render_mode = make_env(spec, kwargs, render=True)
    except Exception as exc:
        checks.append(_check("construct", "Environment can be created", "fail",
                             "Creating the environment raised an exception.", exception=exception_info(exc)))
        report["score"] = 0
        return report
    checks.append(_check("construct", "Environment can be created", "pass", f"{type(env.unwrapped).__name__} created."))
    labels = labels_for(spec, kwargs)["observation"]

    try:
        try:
            report["inspection"] = inspect_env(env, spec, render_mode, kwargs, seed)
        except Exception:
            report["inspection"] = None

        emit("Gymnasium env_checker", 0.08)
        try:
            from gymnasium.utils.env_checker import check_env

            params = pyinspect.signature(check_env).parameters
            options = {k: True for k in ("skip_render_check", "skip_close_check") if k in params}
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                check_env(env.unwrapped, **options)
            messages = sorted({re.sub(r"\x1b\[[0-9;]*m", "", str(w.message)).strip()[:300] for w in caught})
            if messages:
                checks.append(_check("gym_checker", "Gymnasium env_checker", "warn",
                                     f"Passed with {len(messages)} warning(s).", messages=messages))
            else:
                checks.append(_check("gym_checker", "Gymnasium env_checker", "pass", "No errors or warnings."))
        except Exception as exc:
            checks.append(_check("gym_checker", "Gymnasium env_checker", "fail",
                                 str(exc)[:500] or type(exc).__name__, exception=exception_info(exc)))

        emit("reset() contract", 0.15)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            try:
                out = env.reset(seed=seed)
                if not isinstance(out, tuple) or len(out) != 2:
                    checks.append(_check("reset_contract", "reset() returns (obs, info)", "fail",
                                         f"reset() returned {type(out).__name__} instead of a 2-tuple."))
                else:
                    problems = []
                    if not isinstance(out[1], dict):
                        problems.append(f"info is {type(out[1]).__name__}, expected dict")
                    bad = [a for a in check_transition(out[0], 0.0, env.observation_space, labels)]
                    problems += [a["message"] for a in bad]
                    checks.append(_check("reset_contract", "reset() returns (obs, info)",
                                         "fail" if problems else "pass",
                                         "; ".join(problems) if problems else "Returns a valid observation and an info dict."))
            except Exception as exc:
                checks.append(_check("reset_contract", "reset() returns (obs, info)", "fail",
                                     f"reset() raised {type(exc).__name__}: {exc}", exception=exception_info(exc)))

            emit("Seeding", 0.2)
            try:
                a, _ = env.reset(seed=seed)
                b, _ = env.reset(seed=seed)
                fa, fb = flat_obs(a), flat_obs(b)
                same_seed = fa is not None and fb is not None and fa.shape == fb.shape and np.allclose(fa, fb, equal_nan=True)
                firsts = [flat_obs(env.reset(seed=seed + k)[0]) for k in range(1, 6)]
                varied = any(f is not None and fa is not None and (f.shape != fa.shape or not np.allclose(f, fa, equal_nan=True)) for f in firsts)
                if not same_seed:
                    checks.append(_check("seeding", "reset(seed) is reproducible", "fail",
                                         "Two resets with the same seed gave different observations. Use self.np_random "
                                         "and call super().reset(seed=seed)."))
                elif not varied:
                    checks.append(_check("seeding", "reset(seed) is reproducible", "info",
                                         "Same seed → same start. Different seeds also gave the same start: fine if your "
                                         "start state is fixed, otherwise reset() may be ignoring the seed."))
                else:
                    checks.append(_check("seeding", "reset(seed) is reproducible", "pass",
                                         "Same seed → same start; different seeds → different starts."))
            except Exception as exc:
                checks.append(_check("seeding", "reset(seed) is reproducible", "fail", str(exc)[:300],
                                     exception=exception_info(exc)))

        emit("Determinism", 0.28)
        try:
            horizon = 200
            r1 = run_episode(env, seed, horizon, record=True, labels=labels)
            r2 = run_episode(env, seed, horizon, record=True, labels=labels)
            diverged = None
            for t, (o1, o2) in enumerate(zip(r1.observations or [], r2.observations or [])):
                if o1 is None or o2 is None or o1.shape != o2.shape or not np.allclose(o1, o2, equal_nan=True):
                    diverged = t
                    break
            if diverged is None and len(r1.observations or []) != len(r2.observations or []):
                diverged = min(len(r1.observations or []), len(r2.observations or []))
            if diverged is None:
                for t, (x, y) in enumerate(zip(r1.rewards or [], r2.rewards or [])):
                    if not np.isclose(float(x), float(y), equal_nan=True):
                        diverged = t + 1
                        break
            if diverged is None:
                checks.append(_check("determinism", "Same seed + actions → same trajectory", "pass",
                                     f"Two runs of {r1.length} steps matched exactly. Failures can be replayed reliably."))
            else:
                checks.append(_check("determinism", "Same seed + actions → same trajectory", "fail",
                                     f"Trajectories diverged at step {diverged}. Randomness outside self.np_random "
                                     "(e.g. random / np.random / time) makes failures impossible to reproduce."))
        except Exception as exc:
            checks.append(_check("determinism", "Same seed + actions → same trajectory", "fail", str(exc)[:300],
                                 exception=exception_info(exc)))

        emit("Random rollouts", 0.35)
        profile = RewardProfile(seed)
        first: dict[str, dict] = {}
        counts: dict[str, int] = {}
        episodes = steps = capped = ended = 0
        max_ep = getattr(getattr(env, "spec", None), "max_episode_steps", None) or 1000
        roll_start = time.perf_counter()
        while steps < step_budget and time.perf_counter() - roll_start < time_budget and not cancelled():
            ep_seed = seed + 1000 + episodes
            limit = min(max_ep, step_budget - steps)
            res = run_episode(env, ep_seed, limit, labels=labels, record=True)
            for r in res.rewards or []:
                profile.add(r)
            episodes += 1
            steps += res.length
            capped += int(res.capped and limit == max_ep)
            ended += int(res.terminated or res.truncated)
            profile.end_episode(res.total_reward, res.length)
            for issue in res.issues:
                counts[issue.code] = counts.get(issue.code, 0) + 1
                if issue.code not in first:
                    first[issue.code] = {"message": issue.message, "level": issue.level,
                                         "evidence": _evidence(res, issue, episodes), "exception": issue.exception}
            emit("Random rollouts", 0.35 + 0.55 * min(1.0, steps / step_budget))
        elapsed = max(time.perf_counter() - roll_start, 1e-9)

        def first_ev(*codes: str) -> dict | None:
            for c in codes:
                if c in first:
                    return first[c]
            return None

        crash = first_ev("exception_step", "exception_reset")
        checks.append(_check("crashes", "No exceptions during rollouts",
                             "fail" if crash else "pass",
                             crash["message"] if crash else f"{episodes} episodes / {steps} steps without exceptions.",
                             evidence=crash and crash["evidence"], exception=crash and crash["exception"],
                             count=sum(counts.get(c, 0) for c in ("exception_step", "exception_reset"))))

        sc = first_ev("step_contract")
        checks.append(_check("step_contract", "step() returns (obs, reward, terminated, truncated, info)",
                             ("fail" if sc["level"] == "critical" else "warn") if sc else "pass",
                             sc["message"] if sc else "Every step returned a well-formed 5-tuple.",
                             evidence=sc and sc["evidence"]))

        ob = first_ev("shape_mismatch", "out_of_bounds", "dtype_mismatch", "not_in_space")
        ob_level = "fail" if ob and (ob["level"] == "critical" or "out_of_bounds" in first or "shape_mismatch" in first) else "warn"
        checks.append(_check("observation_space", "Observations stay inside observation_space",
                             ob_level if ob else "pass",
                             ob["message"] if ob else "Every observation matched the declared space.",
                             evidence=ob and ob["evidence"],
                             count=sum(counts.get(c, 0) for c in ("shape_mismatch", "out_of_bounds", "dtype_mismatch", "not_in_space"))))

        nan = first_ev("nan_observation", "inf_observation", "nan_reward", "inf_reward", "invalid_reward")
        checks.append(_check("nan_inf", "No NaN / Inf in observations or rewards",
                             "fail" if nan else "pass", nan["message"] if nan else "All values finite.",
                             evidence=nan and nan["evidence"],
                             count=sum(counts.get(c, 0) for c in ("nan_observation", "inf_observation", "nan_reward", "inf_reward", "invalid_reward"))))

        ex = first_ev("exploding_observation", "exploding_reward")
        checks.append(_check("exploding", "No exploding values", "warn" if ex else "pass",
                             ex["message"] if ex else "No observation above 1e8 or reward above 1e6.",
                             evidence=ex and ex["evidence"]))

        lengths = profile.lengths
        if episodes and ended == 0:
            checks.append(_check("termination", "Episodes end", "warn",
                                 f"No episode terminated or truncated within {max_ep} steps. Add a TimeLimit "
                                 "(max_episode_steps) or a termination condition."))
        elif capped > episodes / 2:
            checks.append(_check("termination", "Episodes end", "warn",
                                 f"{capped}/{episodes} random episodes hit the {max_ep}-step cap without ending."))
        else:
            mean_len = float(np.mean(lengths)) if lengths else 0.0
            which = f"All {episodes}" if ended >= episodes else f"{ended}/{episodes}"
            checks.append(_check("termination", "Episodes end", "pass",
                                 f"{which} episodes ended (mean length {mean_len:.1f} steps under a random policy)."))

        rp = profile.result()
        report["rewardProfile"] = rp
        if rp.get("steps"):
            distinct = rp.get("distinct")
            sparsity = rp.get("sparsity")
            if distinct == 1:
                checks.append(_check("reward_signal", "Reward carries a learning signal", "info",
                                     f"Constant reward ({rp['min']:+g} every step): a survival-style reward, so the "
                                     "learning signal comes from episode length."))
            elif sparsity is not None and sparsity >= 0.95:
                top = rp["topValues"][0]
                rare = rp["topValues"][1:3]
                rare_txt = ", ".join(f"{v['value']:+g} on {100 * v['share']:.2g}%" for v in rare)
                checks.append(_check("reward_signal", "Reward carries a learning signal", "warn",
                                     f"Sparse reward: {100 * top['share']:.1f}% of random steps give {top['value']:+g} "
                                     f"(others: {rare_txt}). Exploration may struggle; consider shaping."))
            else:
                checks.append(_check("reward_signal", "Reward carries a learning signal", "pass",
                                     f"{distinct if distinct is not None else 'many'} distinct reward values; "
                                     f"{100 * rp['positive']:.0f}% positive / {100 * rp['negative']:.0f}% negative steps."))

        emit("Rendering", 0.93)
        if render_mode is None:
            checks.append(_check("render", "render() produces frames", "info",
                                 "No rgb_array/ansi render mode: the Arena will show observations without video."))
        else:
            try:
                env.reset(seed=seed)
                frame = encode_frame(env.render())
                if frame is None:
                    checks.append(_check("render", "render() produces frames", "warn",
                                         f"render() returned None in {render_mode} mode."))
                else:
                    report["frame"] = frame
                    size = f"{frame['width']}×{frame['height']}" if frame["kind"] == "image" else "text"
                    checks.append(_check("render", "render() produces frames", "pass", f"{render_mode}: {size}."))
            except Exception as exc:
                checks.append(_check("render", "render() produces frames", "warn",
                                     f"render() raised {type(exc).__name__}: {exc}", exception=exception_info(exc)))

        sps = steps / elapsed
        checks.append(_check("performance", "Step throughput", "warn" if sps < 200 else "info",
                             f"{sps:,.0f} steps/s with a random policy" + (" — slow environments make training expensive." if sps < 200 else ".")))

        report["stats"] = {"episodes": episodes, "steps": steps, "stepsPerSecond": sps,
                           "seconds": time.perf_counter() - started, "cancelled": cancelled()}
        report["score"] = score(checks)
        emit("Done", 1.0)
        return report
    finally:
        try:
            env.close()
        except Exception:
            pass
