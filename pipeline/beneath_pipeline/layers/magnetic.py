"""EMAG2v3 (upward-continued) magnetic anomaly -> magnetic.v1.pmtiles.

Source grid facts (checked on EMAG2_V3_20170530_UpCont.tif):
- float32, 10800 x 5399, nodata = -3.4028235e38 (float32 lowest), about 3% nodata
- no CRS tag (geographic WGS84 implied), no AREA_OR_POINT tag (GDAL default: Area)
- geotransform origin (-1/60, 89.98333) with 2' pixels, so pixel centres fall on
  2-arc-minute nodes: lon 0..359 58', lat -89 58'..+89 58' (poles excluded).
  We treat each value as a point sample at its pixel centre. (For a PixelIsPoint
  file GDAL already shifts the geotransform by half a pixel, so centre = node
  either way.) Columns cover exactly 360 degrees, so interpolation wraps at
  the 0/360 seam and there is no seam at +-180.
"""
from __future__ import annotations

import numpy as np
import rasterio

from ..config import DERIVED_DIR, load_config
from ..fetch import fetch
from ..tiles import Grid, GridSpec
from .raster_common import build_raster_layer

GRID_PATH = DERIVED_DIR / "magnetic_grid"


def load_grid(cfg: dict) -> Grid:
    src = cfg["source"]
    path = fetch(src["url"], src["filename"], licence=src.get("licence"))
    with rasterio.open(path) as ds:
        data = ds.read(1).astype(np.float32)
        t = ds.transform
        nodata = ds.nodata
        aop = ds.tags().get("AREA_OR_POINT", "Area")
    if nodata is not None:
        data[data == np.float32(nodata)] = np.nan
    data[~np.isfinite(data)] = np.nan
    data[np.abs(data) > 1e6] = np.nan  # guard against any other fill values
    nrows, ncols = data.shape
    dlon, dlat = t.a, t.e
    wrap = abs(ncols * dlon - 360.0) < 1e-4
    if wrap:
        dlon = 360.0 / ncols
    spec = GridSpec(
        nrows=nrows, ncols=ncols,
        lat0=round(t.f + dlat / 2, 9), dlat=-abs(dlon) if abs(abs(dlat) - abs(dlon)) < 1e-6 else dlat,
        lon0=round(t.c + t.a / 2, 9), dlon=dlon,
        wrap=wrap, geocentric=False,
    )
    print(f"[magnetic] grid {nrows}x{ncols} {aop}, lat0={spec.lat0} lon0={spec.lon0} "
          f"step={spec.dlon:.6f}, nodata={np.isnan(data).mean() * 100:.2f}%")
    return Grid(data, spec)


def prepare() -> Grid:
    cfg = load_config("magnetic")
    grid = load_grid(cfg)
    grid.save(GRID_PATH)
    return grid


def build() -> dict:
    cfg = load_config("magnetic")
    prepare()
    return build_raster_layer(cfg, GRID_PATH)
