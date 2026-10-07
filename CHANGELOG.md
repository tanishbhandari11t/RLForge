# Changelog

## 0.1.0

First public release.

- Agent Arena: live rendering, play/pause/step/step back, speed control, reward timeline and step debugger.
- Random agent and Stable-Baselines3 models (PPO, A2C, DQN, SAC, TD3, DDPG), showing policy probabilities, V(s) and Q-values.
- Environment health check: `check_env`, reset/step contract, seeding, determinism, crashes, NaN/Inf, space violations, reward signal.
- Fuzzer that groups failures, checks they reproduce, minimises the action sequence and replays it in one click.
- Episode recording and deterministic replay, with divergence detection.
- Reward detective and Environment Inspector.
- Project scan, CodeLens, Explorer launcher and Watch Agent from the `.zip` context menu.
