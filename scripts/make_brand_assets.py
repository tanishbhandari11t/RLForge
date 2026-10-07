"""Generate extension icons from media/logo-source.jpg.

    python scripts/make_brand_assets.py

Outputs:
    media/icon.png   256x256 marketplace icon (full logo on dark background)
    media/logo.png   512x512 full logo with transparent background
    media/mark.png   256x256 emblem only (no wordmark) with transparent background
"""

from __future__ import annotations

import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, "media")


def to_transparent(img: Image.Image, floor: float = 0.06) -> Image.Image:
    """Turn the near-black background into alpha, keeping colours and glow intact."""
    rgb = np.asarray(img.convert("RGB")).astype(np.float64) / 255.0
    alpha = rgb.max(axis=2)
    alpha = np.clip((alpha - floor) / (1.0 - floor), 0.0, 1.0)
    alpha = np.clip(alpha * 1.6, 0.0, 1.0)
    safe = np.maximum(alpha, 1e-3)[..., None]
    colour = np.clip(rgb / safe, 0.0, 1.0)
    colour = np.where(alpha[..., None] > 1e-3, colour, 0.0)
    out = np.dstack([colour, alpha[..., None]])
    return Image.fromarray((out * 255).round().astype(np.uint8))


def main() -> None:
    src = Image.open(os.path.join(MEDIA, "logo-source.jpg")).convert("RGB")
    w, h = src.size

    icon = src.crop((int(w * 0.14), int(h * 0.14), int(w * 0.86), int(h * 0.86))).resize((256, 256), Image.LANCZOS)
    icon.save(os.path.join(MEDIA, "icon.png"))

    full = src.crop((int(w * 0.18), int(h * 0.17), int(w * 0.84), int(h * 0.83))).resize((512, 512), Image.LANCZOS)
    to_transparent(full).save(os.path.join(MEDIA, "logo.png"))

    mark = src.crop((int(w * 0.28), int(h * 0.175), int(w * 0.75), int(h * 0.645))).resize((256, 256), Image.LANCZOS)
    to_transparent(mark).save(os.path.join(MEDIA, "mark.png"))
    print("Wrote icon.png, logo.png, mark.png")


if __name__ == "__main__":
    main()
