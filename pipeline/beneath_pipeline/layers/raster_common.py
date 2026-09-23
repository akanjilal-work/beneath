"""Shared steps for value-encoded raster layers: statistics, layer entry, tiling."""
from __future__ import annotations

import json
import math

import numpy as np

from ..config import DERIVED_DIR
from ..encode import default_offset
from ..manifest import layer_entry_path, raster_layer_entry, write_layer_entry
from ..paths import OUT_DIR
from ..tiles import PMTILES_ZOOM_OFFSET, Grid, build_raster_pmtiles, tile_cols, tile_rows


def nice_round(x: float, sig: int = 2) -> float:
    if x == 0 or not math.isfinite(x):
        return 0.0
    p = math.floor(math.log10(abs(x))) - (sig - 1)
    return float(round(x / 10 ** p) * 10 ** p)


def grid_stats(grid: Grid) -> dict:
    """Data range and display range (98th percentile of |value|, area-weighted over the full sphere)."""
    s = grid.spec
    lats = s.lat0 + np.arange(s.nrows) * s.dlat
    data = np.asarray(grid.data, dtype=np.float64)
    w = np.clip(np.cos(np.radians(lats)), 0.0, None)[:, None] * np.ones((1, s.ncols))
    finite = np.isfinite(data)
    v = data[finite]
    wv = w[finite]
    order = np.argsort(np.abs(v))
    cw = np.cumsum(wv[order])
    cw /= cw[-1]
    p98 = float(np.abs(v)[order][np.searchsorted(cw, 0.98)])
    full = np.asarray(grid.data, dtype=np.float64)
    return {
        "dataMin": float(np.nanmin(full)),
        "dataMax": float(np.nanmax(full)),
        "absP98": p98,
        "validFraction": float(finite.mean()),
    }


def level_stats(pmtiles_path, *, scale: float, offset: float, minzoom: int, maxzoom: int,
                zoom_offset: int = 0) -> dict:
    """Per-level statistics the app uses to make every level look alike.

    levelGain: coarser levels are 2x2 means of the level above, so anomalies lose
      amplitude as you zoom out. The app divides the display range by this gain when
      colouring a tile at that level. Gain = 98th percentile of |value| at maxzoom /
      the same at z, capped at 4. Colour only: click queries always read maxzoom.
    pixelStep: mean |difference| between vertically adjacent pixels at each level. The
      app scales relief shading by 1/pixelStep so slopes look the same at every level.
      (Scaling by 2^level would assume a smooth field; rough fields such as magnetic
      anomalies shrink by much less than 2x per level, which showed as bands.)
    """
    import io

    from PIL import Image
    from pmtiles.reader import MmapSource, Reader

    from ..encode import decode_rgb

    p98: dict[int, float] = {}
    step: dict[int, float] = {}
    with open(pmtiles_path, "rb") as f:
        reader = Reader(MmapSource(f))
        for z in range(minzoom, maxzoom + 1):
            cols, rows = 2 ** (z + 1), 2 ** z
            stride = max(1, rows // 8)  # sample at most 16 x 8 tiles per level
            vals, diffs = [], []
            for x in range(0, cols, stride):
                for y in range(0, rows, stride):
                    data = reader.get(z + zoom_offset, x, y)
                    if not data:
                        continue
                    v = decode_rgb(np.asarray(Image.open(io.BytesIO(data)).convert("RGB")), scale, offset)
                    d = np.abs(np.diff(v, axis=0))
                    vals.append(np.abs(v[np.isfinite(v)]))
                    diffs.append(d[np.isfinite(d)])
            p98[z] = float(np.percentile(np.concatenate(vals), 98))
            step[z] = float(np.mean(np.concatenate(diffs)))
    ref = p98[maxzoom]
    return {
        "levelGain": [round(min(4.0, max(1.0, ref / p98[z])), 3) for z in range(minzoom, maxzoom + 1)],
        "pixelStep": [round(step[z], 4) for z in range(minzoom, maxzoom + 1)],
    }


def build_raster_layer(cfg: dict, grid_path) -> dict:
    grid = Grid.load(grid_path, mmap=False)
    stats = grid_stats(grid)
    scale = float(cfg["scale"])
    offset = float(cfg.get("offset", default_offset(scale)))
    disp = nice_round(stats["absP98"])
    entry = raster_layer_entry(
        cfg, scale=scale, offset=offset,
        data_min=round(stats["dataMin"], 1), data_max=round(stats["dataMax"], 1),
        display_min=-disp, display_max=disp,
    )
    del grid
    out = OUT_DIR / cfg["file"]
    print(f"[{cfg['id']}] tiling z{cfg['minzoom']}..z{cfg['maxzoom']} -> {out.name}")
    tstats = build_raster_pmtiles(grid_path, out, scale=scale, offset=offset,
                                  minzoom=cfg["minzoom"], maxzoom=cfg["maxzoom"], metadata=entry)
    entry.update(level_stats(out, scale=scale, offset=offset, minzoom=cfg["minzoom"], maxzoom=cfg["maxzoom"],
                             zoom_offset=entry["pmtilesZoomOffset"]))
    write_layer_entry(entry)
    report = {"layer": cfg["id"], "stats": stats, "tiles": tstats}
    (DERIVED_DIR / f"{cfg['id']}.buildstats.json").write_text(json.dumps(report, indent=2))
    for z, s in tstats["perZoom"].items():
        print(f"[{cfg['id']}]   z{z}: {s['tiles']} tiles, {s['bytes'] / 1e6:.2f} MB")
    print(f"[{cfg['id']}] file {tstats['fileBytes'] / 1e6:.2f} MB; display +/-{disp}; "
          f"data {stats['dataMin']:.1f}..{stats['dataMax']:.1f}")
    return report


__all__ = ["build_raster_layer", "grid_stats", "nice_round", "layer_entry_path"]
