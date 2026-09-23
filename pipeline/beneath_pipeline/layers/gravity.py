"""EGM2008 free-air gravity anomaly -> gravity.v1.pmtiles.

What is computed
----------------
Free-air gravity anomaly in spherical approximation (the quantity ICGEM calls
"gravity_anomaly_sa"), on the surface of the WGS84 ellipsoid (h = 0):

    dg = -dT/dr - 2 T / r = GM/r^2 * sum_l (l - 1) (R/r)^l sum_m T_lm Y_lm

where T is the disturbing potential: EGM2008 (tide-free, fully normalised,
degrees 2..lmax) minus the WGS84 normal potential (even zonal terms C20..C10,0
from the closed-form series for a level ellipsoid, rescaled to EGM2008's GM
and R). Degrees 0 and 1 are set to zero.

How
---
SHTOOLS' MakeGravGridDH evaluates the radial derivative of a potential on a
flattened ellipsoid: dV/dr = -GM/r^2 sum (l + 1)(R/r)^l C_lm Y_lm. Feeding it
C'_lm = T_lm (l - 1)/(l + 1) (no rotation, no normal gravity) therefore
returns -dg, with the correct (R/r)^l height dependence at every latitude.

The output Driscoll-Healy grid is sampled at *geocentric* latitudes (points
on the ellipsoid at geocentric colatitude theta). The sampler converts the
geodetic latitude of each tile pixel to geocentric before lookup
(the difference reaches 0.19 degrees, about 21 km, at 45 degrees).
"""
from __future__ import annotations

import math
import time

import numpy as np

from ..config import DERIVED_DIR, load_config
from ..fetch import fetch
from ..tiles import Grid, GridSpec
from .raster_common import build_raster_layer

GRID_PATH = DERIVED_DIR / "gravity_grid"

# WGS84 defining constants (NGA TR8350.2)
WGS84_A = 6378137.0
WGS84_F = 1.0 / 298.257223563
WGS84_GM = 3.986004418e14
WGS84_C20 = -0.484166774985e-3  # fully normalised C20 of the WGS84 normal field


def normal_zonal_coeffs(gm_model: float, r0_model: float, nmax: int = 5) -> dict[int, float]:
    """Fully normalised even zonal coefficients C_{2n,0} of the WGS84 normal potential,
    rescaled to (gm_model, r0_model). Heiskanen & Moritz (1967) eq. 2-92."""
    e2 = 2 * WGS84_F - WGS84_F ** 2
    j2 = -WGS84_C20 * math.sqrt(5.0)
    out = {}
    for n in range(1, nmax + 1):
        j2n = ((-1) ** (n + 1)) * 3 * e2 ** n / ((2 * n + 1) * (2 * n + 3)) * (1 - n + 5 * n * j2 / e2)
        c = -j2n / math.sqrt(4 * n + 1)
        l = 2 * n
        out[l] = c * (WGS84_GM / gm_model) * (WGS84_A / r0_model) ** l
    return out


def compute_grid(cfg: dict, lmax: int | None = None) -> Grid:
    import pyshtools as pysh

    lmax = lmax or cfg["lmax"]
    src = cfg["source"]
    path = fetch(src["url"], src["filename"], expected_sha256=src.get("sha256"), licence=src.get("licence"))
    t0 = time.time()
    clm = pysh.SHGravCoeffs.from_file(str(path), format="icgem", lmax=lmax, encoding="utf-8")
    gm, r0 = float(clm.gm), float(clm.r0)
    print(f"[gravity] read EGM2008 to degree {clm.lmax} (GM={gm}, R={r0}) in {time.time() - t0:.0f}s")

    c = np.array(clm.coeffs, dtype=np.float64)  # (2, L+1, L+1), 4pi-normalised, CS phase +1
    for l, cn in normal_zonal_coeffs(gm, r0).items():
        if l <= lmax:
            c[0, l, 0] -= cn
    c[:, 0:2, :] = 0.0
    ls = np.arange(lmax + 1, dtype=np.float64)
    factor = (ls - 1.0) / (ls + 1.0)
    c *= factor[None, :, None]

    t0 = time.time()
    rad, _theta, _phi, _total, _pot = pysh.backends.shtools.MakeGravGridDH(
        c, gm, r0, a=WGS84_A, f=WGS84_F, lmax=lmax, sampling=2,
        omega=0.0, normal_gravity=0, extend=1)
    print(f"[gravity] MakeGravGridDH lmax={lmax} grid {rad.shape} in {time.time() - t0:.0f}s")
    dg = (-rad * 1e5).astype(np.float32)  # m/s^2 -> mGal
    del rad, _theta, _phi, _total, _pot
    n = dg.shape[0] - 1  # extend=1 adds the 90S row and 360E column
    dg = np.ascontiguousarray(dg[:, :-1])  # drop duplicated 360E column so columns wrap
    spec = GridSpec(nrows=dg.shape[0], ncols=dg.shape[1], lat0=90.0, dlat=-180.0 / n,
                    lon0=0.0, dlon=360.0 / dg.shape[1], wrap=True, geocentric=True)
    print(f"[gravity] anomaly range {np.nanmin(dg):.1f}..{np.nanmax(dg):.1f} mGal, "
          f"mean {float(np.mean(dg)):.2f}")
    return Grid(dg, spec)


def prepare(force: bool = False) -> Grid:
    cfg = load_config("gravity")
    if Grid.exists(GRID_PATH) and not force:
        g = Grid.load(GRID_PATH)
        if g.spec.nrows == 2 * cfg["lmax"] + 3:
            print(f"[gravity] reusing cached grid {g.data.shape} (use --force to recompute)")
            return g
    grid = compute_grid(cfg)
    grid.save(GRID_PATH)
    return grid


def build(force: bool = False) -> dict:
    cfg = load_config("gravity")
    prepare(force=force)
    return build_raster_layer(cfg, GRID_PATH)
