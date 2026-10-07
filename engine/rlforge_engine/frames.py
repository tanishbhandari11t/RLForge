"""Encoding rendered frames (rgb arrays or ANSI text) for transport to the webview."""

from __future__ import annotations

import base64
import io
import struct
import zlib
from typing import Any

import numpy as np

try:
    from PIL import Image

    _HAS_PIL = True
except Exception:  # pragma: no cover - Pillow is optional
    _HAS_PIL = False

MAX_DIM = 720
SMALL_FRAME = 256


def _to_uint8_rgb(frame: Any) -> np.ndarray:
    arr = np.asarray(frame)
    if arr.dtype != np.uint8:
        arr = arr.astype(np.float64)
        if arr.size and np.nanmax(arr) <= 1.0:
            arr = arr * 255.0
        arr = np.clip(np.nan_to_num(arr), 0, 255).astype(np.uint8)
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, axis=-1)
    if arr.ndim == 3 and arr.shape[2] == 1:
        arr = np.repeat(arr, 3, axis=2)
    if arr.ndim == 3 and arr.shape[2] == 4:
        arr = arr[:, :, :3]
    if arr.ndim != 3 or arr.shape[2] != 3:
        raise ValueError(f"Unsupported frame shape {arr.shape}")
    return np.ascontiguousarray(arr)


def _png_bytes(arr: np.ndarray) -> bytes:
    h, w, _ = arr.shape
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )


def encode_frame(frame: Any) -> dict | None:
    if frame is None:
        return None
    if isinstance(frame, str):
        return {"kind": "text", "text": frame}
    if isinstance(frame, (list, tuple)) and frame and not isinstance(frame[0], (int, float)):
        frame = frame[-1]  # rgb_array_list
    arr = _to_uint8_rgb(frame)
    h, w, _ = arr.shape
    small = max(h, w) <= SMALL_FRAME

    if _HAS_PIL:
        img = Image.fromarray(arr)
        if max(h, w) > MAX_DIM:
            scale = MAX_DIM / max(h, w)
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.BILINEAR)
        buf = io.BytesIO()
        if small:
            img.save(buf, format="PNG", optimize=False)
            mime = "image/png"
        else:
            img.save(buf, format="JPEG", quality=82)
            mime = "image/jpeg"
        data = buf.getvalue()
        w, h = img.size
    else:
        data = _png_bytes(arr)
        mime = "image/png"

    return {
        "kind": "image",
        "src": f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}",
        "width": w,
        "height": h,
        "pixelated": small,
    }
