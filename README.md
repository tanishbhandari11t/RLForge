# RLForge

Watch, inspect and debug reinforcement-learning agents and Gymnasium environments directly inside VS Code / Cursor.

## Install

```bash
npm install
npm --prefix webview-ui install
pip install "gymnasium[classic-control]" stable-baselines3

npm start    # builds, packages rlforge-<version>.vsix and installs it into Cursor / VS Code
```

Reload the editor window once. Then, in any project: **Explorer → RLForge** (Open Agent Arena / Test Environment /
Fuzz Environment / Episode Replays), the RLForge icon in the activity bar, or the **Watch · Test · Fuzz · Inspect**
CodeLens above `gym.make(...)` and custom `gym.Env` classes. The Arena opens as a tab in the
same window. To install elsewhere, use Extensions → `...` → **Install from VSIX…** with the generated `.vsix`.

## Features

RLForge is DevTools for RL environments and agents: zero code changes, no browser, everything in an editor tab.

- **Agent Arena**: live rendered environment, play / pause / step / step back / reset, 0.1x–10x speed, a timeline
  you can scrub, and a step debugger showing state → action (probabilities, V(s), Q-values) → reward → next state.
  Every step is checked for NaN/Inf, observation-space violations and exploding values.
- **Agents**: random agent, or any Stable-Baselines3 model (`.zip`, algorithm auto-detected). Right-click a `.zip` in
  the Explorer → **Watch Agent in RLForge**.
- **🩺 Environment health check** (`Test` CodeLens / sidebar button): Gymnasium `check_env` plus what it doesn't
  cover: reset/step contract, seeding, determinism (same seed + actions → same trajectory), crashes, NaN/Inf, space
  violations, exploding values, termination, reward signal, rendering and throughput. The score is derived from the
  checklist. Each failure carries the seed + action sequence, with **Replay in Arena**. New custom envs trigger a
  one-time prompt to run it.
- **🧨 Fuzzer**: 100–10,000 seeded episodes (uniform or boundary-biased actions). Failures are grouped by cause,
  verified to reproduce, **shrunk to the minimal action sequence** (delta debugging) and replayable in one click; the
  Arena pauses on the failing step.
- **🎥 Episode replay**: toggle ⏺ Record (or 💾 Save episode) in the Arena; episodes go to `.rlforge/episodes/*.jsonl`.
  Replays re-simulate from seed + actions, show the recorded agent decisions, and flag the exact step where a
  non-deterministic environment diverges from the recording.
- **🎯 Reward detective**: reward distribution, sparsity, sign balance, distinct values and random-policy returns with
  plain-language warnings.
- **Environment Inspector**: spaces with labels, bounds, episode limits, render modes, wrapper stack, source link.
- **Project scan**: detects `gym.make` ids, custom `gym.Env` classes (`file.py:ClassName`), SB3 models and training scripts.

## Layout

- `src/` – extension host (engine process, project scanner, tree view, CodeLens, webview panel)
- `webview-ui/` – React + Vite UI rendered inside the editor
- `engine/rlforge_engine/` – Python engine, JSON-lines protocol over stdin/stdout
- `examples/` – CartPole PPO training script and a custom (plus deliberately buggy) GridWorld env

Engine test: `python engine/tests/smoke_test.py [path/to/model.zip]`
