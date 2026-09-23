import numpy as np

from beneath_pipeline.encode import (RAW_MAX, RAW_MID, decode_rgb, default_offset, encode_rgb,
                                     encode_values, raw_to_rgb, rgb_to_raw)


def test_zero_maps_to_mid():
    assert encode_values(np.array([0.0]), 0.1, default_offset(0.1))[0] == RAW_MID


def test_round_trip_within_half_scale():
    rng = np.random.default_rng(0)
    for scale in (1.0, 0.1, 0.01):
        off = default_offset(scale)
        v = rng.uniform(-5000, 5000, size=(64, 64))
        back = decode_rgb(encode_rgb(v, scale, off), scale, off)
        assert np.max(np.abs(back - v)) <= scale / 2 + 1e-9


def test_nodata_and_clipping():
    scale, off = 1.0, default_offset(1.0)
    v = np.array([[np.nan, -1e9, 1e9, 5.0]])
    raw = encode_values(v, scale, off)
    assert raw[0, 0] == 0                  # nodata
    assert raw[0, 1] == 1                  # clipped low, never 0
    assert raw[0, 2] == RAW_MAX            # clipped high
    back = decode_rgb(raw_to_rgb(raw), scale, off)
    assert np.isnan(back[0, 0]) and back[0, 3] == 5.0


def test_rgb_byte_layout():
    raw = np.array([[0x123456]], dtype=np.uint32)
    rgb = raw_to_rgb(raw)
    assert rgb.dtype == np.uint8 and tuple(rgb[0, 0]) == (0x12, 0x34, 0x56)
    assert rgb_to_raw(rgb)[0, 0] == 0x123456
