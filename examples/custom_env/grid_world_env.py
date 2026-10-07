"""A tiny custom Gymnasium environment for trying RLForge on your own code.

Open this file in VS Code with RLForge installed and use the CodeLens above the
class to watch it in the Agent Arena. ``BuggyGridWorldEnv`` contains deliberate
bugs (NaN observations and out-of-bounds values) that RLForge flags per step.
"""

from __future__ import annotations

import gymnasium as gym
import numpy as np
from gymnasium import spaces

CELL = 48
COLORS = {
    "bg": (18, 22, 36),
    "grid": (38, 46, 70),
    "agent": (59, 130, 246),
    "goal": (34, 211, 153),
    "wall": (99, 102, 241),
    "trail": (30, 64, 120),
}


class GridWorldEnv(gym.Env):
    """Navigate a 7x7 grid from the top-left corner to the goal while avoiding walls.

    Observation: [agent_x, agent_y, goal_x, goal_y] normalised to [0, 1].
    Actions: 0 = up, 1 = right, 2 = down, 3 = left.
    Reward: -0.01 per step, -0.1 for bumping into a wall, +1 for reaching the goal.
    """

    metadata = {"render_modes": ["rgb_array"], "render_fps": 8}

    def __init__(self, render_mode: str | None = None, size: int = 7):
        self.size = size
        self.render_mode = render_mode
        self.observation_space = spaces.Box(0.0, 1.0, shape=(4,), dtype=np.float32)
        self.action_space = spaces.Discrete(4)
        self.walls = {(3, 1), (3, 2), (3, 3), (1, 5), (2, 5), (5, 4), (5, 5)}
        self._moves = {0: (0, -1), 1: (1, 0), 2: (0, 1), 3: (-1, 0)}
        self.agent = (0, 0)
        self.goal = (size - 1, size - 1)
        self.trail: list[tuple[int, int]] = []

    def _obs(self) -> np.ndarray:
        n = self.size - 1
        return np.array([self.agent[0] / n, self.agent[1] / n, self.goal[0] / n, self.goal[1] / n], dtype=np.float32)

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        self.agent = (0, 0)
        free = [(x, y) for x in range(self.size) for y in range(self.size) if (x, y) not in self.walls and (x, y) != (0, 0)]
        far = [c for c in free if c[0] + c[1] >= self.size]
        self.goal = far[self.np_random.integers(len(far))]
        self.trail = [self.agent]
        return self._obs(), {"distance": self._distance()}

    def _distance(self) -> int:
        return abs(self.agent[0] - self.goal[0]) + abs(self.agent[1] - self.goal[1])

    def step(self, action):
        dx, dy = self._moves[int(action)]
        nx, ny = self.agent[0] + dx, self.agent[1] + dy
        reward = -0.01
        if 0 <= nx < self.size and 0 <= ny < self.size and (nx, ny) not in self.walls:
            self.agent = (nx, ny)
        else:
            reward = -0.1
        self.trail.append(self.agent)
        terminated = self.agent == self.goal
        if terminated:
            reward = 1.0
        return self._obs(), reward, terminated, False, {"distance": self._distance()}

    def render(self):
        s = self.size * CELL
        img = np.zeros((s, s, 3), dtype=np.uint8)
        img[:] = COLORS["bg"]
        for (x, y) in self.trail[:-1]:
            img[y * CELL + 6 : (y + 1) * CELL - 6, x * CELL + 6 : (x + 1) * CELL - 6] = COLORS["trail"]
        for (x, y) in self.walls:
            img[y * CELL : (y + 1) * CELL, x * CELL : (x + 1) * CELL] = COLORS["wall"]
        gx, gy = self.goal
        img[gy * CELL + 8 : (gy + 1) * CELL - 8, gx * CELL + 8 : (gx + 1) * CELL - 8] = COLORS["goal"]
        ax, ay = self.agent
        yy, xx = np.mgrid[0:CELL, 0:CELL]
        mask = (xx - CELL / 2) ** 2 + (yy - CELL / 2) ** 2 <= (CELL * 0.36) ** 2
        cell = img[ay * CELL : (ay + 1) * CELL, ax * CELL : (ax + 1) * CELL]
        cell[mask] = COLORS["agent"]
        img[::CELL, :] = COLORS["grid"]
        img[:, ::CELL] = COLORS["grid"]
        return img


class BuggyGridWorldEnv(GridWorldEnv):
    """GridWorld with two planted bugs for RLForge's anomaly detection to catch.

    1. Occasionally divides by zero when normalising, producing NaN observations.
    2. Reports the raw (un-normalised) distance as an extra scale factor, pushing values above 1.0.
    """

    def _obs(self) -> np.ndarray:
        obs = super()._obs()
        if self.np_random.random() < 0.08:
            obs[1] = np.float32(np.nan)
        if self._distance() > 9:
            obs[2] = self._distance() / 4.0
        return obs
