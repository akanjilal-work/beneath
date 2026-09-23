"""Value encoding for raster tiles.

Each pixel is 24-bit RGB (no alpha):
    raw   = R * 65536 + G * 256 + B
    value = raw * scale + offset
    raw == 0 means nodata
"""
from __future__ import annotations

import numpy as np

RAW_MAX = (1 << 24) - 1
RAW_MID = 1 << 23


def default_offset(scale: float) -> float:
    """Offset that maps value 0 to raw 2**23 (the middle of the 24-bit range)."""
    return -RAW_MID * scale


def encode_values(values: np.ndarray, scale: float, offset: float) -> np.ndarray:
    """Float array (NaN = nodata) -> uint32 raw array, clipped to [1, 2**24-1]."""
    v = np.asarray(values, dtype=np.float64)
    finite = np.isfinite(v)
    raw = np.zeros(v.shape, dtype=np.uint32)
    q = np.rint((v[finite] - offset) / scale)
    raw[finite] = np.clip(q, 1, RAW_MAX).astype(np.uint32)
    return raw


def raw_to_rgb(raw: np.ndarray) -> np.ndarray:
    """uint32 raw (H, W) -> uint8 RGB (H, W, 3)."""
    raw = raw.astype(np.uint32)
    return np.stack([(raw >> 16) & 0xFF, (raw >> 8) & 0xFF, raw & 0xFF], axis=-1).astype(np.uint8)


def rgb_to_raw(rgb: np.ndarray) -> np.ndarray:
    rgb = rgb.astype(np.uint32)
    return (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]


def decode_raw(raw: np.ndarray, scale: float, offset: float) -> np.ndarray:
    """uint32 raw -> float64 values with NaN for nodata (the client does the same)."""
    out = raw.astype(np.float64) * scale + offset
    out[raw == 0] = np.nan
    return out


def encode_rgb(values: np.ndarray, scale: float, offset: float) -> np.ndarray:
    return raw_to_rgb(encode_values(values, scale, offset))


def decode_rgb(rgb: np.ndarray, scale: float, offset: float) -> np.ndarray:
    return decode_raw(rgb_to_raw(rgb), scale, offset)
