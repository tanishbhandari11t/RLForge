"""Human-readable labels for the observation/action dimensions of well-known Gymnasium environments."""

from __future__ import annotations

KNOWN: dict[str, dict[str, list[str]]] = {
    "CartPole": {
        "observation": ["Cart position", "Cart velocity", "Pole angle", "Pole angular velocity"],
        "action": ["Push left", "Push right"],
    },
    "MountainCar": {
        "observation": ["Position", "Velocity"],
        "action": ["Accelerate left", "No push", "Accelerate right"],
    },
    "MountainCarContinuous": {
        "observation": ["Position", "Velocity"],
        "action": ["Force"],
    },
    "Acrobot": {
        "observation": ["cos θ1", "sin θ1", "cos θ2", "sin θ2", "θ1 angular velocity", "θ2 angular velocity"],
        "action": ["Torque −1", "Torque 0", "Torque +1"],
    },
    "Pendulum": {
        "observation": ["cos θ", "sin θ", "Angular velocity"],
        "action": ["Torque"],
    },
    "LunarLander": {
        "observation": [
            "X position",
            "Y position",
            "X velocity",
            "Y velocity",
            "Angle",
            "Angular velocity",
            "Left leg contact",
            "Right leg contact",
        ],
        "action": ["Do nothing", "Fire left engine", "Fire main engine", "Fire right engine"],
    },
    "LunarLanderContinuous": {
        "observation": [
            "X position",
            "Y position",
            "X velocity",
            "Y velocity",
            "Angle",
            "Angular velocity",
            "Left leg contact",
            "Right leg contact",
        ],
        "action": ["Main engine", "Lateral engine"],
    },
    "BipedalWalker": {
        "observation": [],
        "action": ["Hip 1", "Knee 1", "Hip 2", "Knee 2"],
    },
    "CarRacing": {
        "observation": [],
        "action": ["Steering", "Gas", "Brake"],
    },
    "FrozenLake": {"observation": ["Cell index"], "action": ["Left", "Down", "Right", "Up"]},
    "FrozenLake8x8": {"observation": ["Cell index"], "action": ["Left", "Down", "Right", "Up"]},
    "CliffWalking": {"observation": ["Cell index"], "action": ["Up", "Right", "Down", "Left"]},
    "Taxi": {
        "observation": ["Encoded state"],
        "action": ["South", "North", "East", "West", "Pickup", "Dropoff"],
    },
    "Blackjack": {
        "observation": ["Player sum", "Dealer card", "Usable ace"],
        "action": ["Stick", "Hit"],
    },
}


def base_name(env_id: str) -> str:
    """'ALE/Pong-v5' -> 'Pong', 'CartPole-v1' -> 'CartPole'."""
    name = env_id.split("/")[-1].split(":")[-1]
    if "-v" in name:
        name = name[: name.rindex("-v")]
    return name


def labels_for(env_id: str, kwargs: dict | None = None) -> dict[str, list[str]]:
    name = base_name(env_id)
    if name == "LunarLander" and kwargs and kwargs.get("continuous"):
        name = "LunarLanderContinuous"
    return KNOWN.get(name, {"observation": [], "action": []})
