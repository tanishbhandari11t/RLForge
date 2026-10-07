# RLForge

Watch, inspect and debug reinforcement-learning agents and Gymnasium environments directly inside VS Code / Cursor.

## Install

```bash
npm install
npm --prefix webview-ui install
pip install "gymnasium[classic-control]" stable-baselines3

npm start    # builds, packages rlforge-<version>.vsix and installs it into Cursor / VS Code
```

Reload the editor window once. Then, in any project: **Explorer → RLForge → Open Agent Arena**, the RLForge icon in
the activity bar, or the **Watch in RLForge Arena** CodeLens above `gym.make(...)`. The Arena opens as a tab in the
same window. To install elsewhere, use Extensions → `...` → **Install from VSIX…** with the generated `.vsix`.

## What's in the MVP

- **Agent Arena**: live rendered environment, play / pause / step / step back / reset, 0.1x–10x speed, a timeline
  you can scrub, and a step debugger showing state → action (probabilities, V(s), Q-values) → reward → next state.
- **Agents**: random agent, or any Stable-Baselines3 model (`.zip`, algorithm auto-detected).
- **Environment Inspector**: spaces with labels, bounds, episode limits, render modes, wrapper stack, source link.
- **Health checks** on every step: NaN/Inf, observation-space violations, exploding values. Exceptions in
  `step()`/`reset()` link straight to the line in your code.
- **Project scan**: detects `gym.make` ids, custom `gym.Env` classes (`file.py:ClassName`), SB3 models and training scripts.

## Layout

- `src/` – extension host (engine process, project scanner, tree view, CodeLens, webview panel)
- `webview-ui/` – React + Vite UI rendered inside the editor
- `engine/rlforge_engine/` – Python engine, JSON-lines protocol over stdin/stdout
- `examples/` – CartPole PPO training script and a custom (plus deliberately buggy) GridWorld env

Engine test: `python engine/tests/smoke_test.py [path/to/model.zip]`
