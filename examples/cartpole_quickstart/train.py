"""Train a PPO agent on CartPole and save it so you can watch it in the RLForge Agent Arena.

    pip install "gymnasium[classic-control]" stable-baselines3
    python examples/cartpole_quickstart/train.py

Then in VS Code: RLForge: Open Agent Arena -> CartPole-v1 -> agent: models/ppo_cartpole.zip
"""

from __future__ import annotations

import os

import gymnasium as gym
from stable_baselines3 import PPO

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, "models", "ppo_cartpole")


def main(timesteps: int = 40_000) -> None:
    env = gym.make("CartPole-v1")
    model = PPO("MlpPolicy", env, verbose=1, seed=0)
    model.learn(total_timesteps=timesteps)
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    model.save(MODEL_PATH)
    print(f"Saved model to {MODEL_PATH}.zip")


if __name__ == "__main__":
    main()
