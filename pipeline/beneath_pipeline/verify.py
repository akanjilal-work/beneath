"""Verify the outputs in pipeline/out/.

Raster layers
  1. Archive checks: PMTiles v3, PNG tiles, no tile compression, metadata equal
     to the layers.json entry, complete geographic pyramid (level z stored at
     PMTiles zoom z + 1, 2^(z+1) x 2^z tiles, nothing outside that range).
  2. Encoding/tiling check: at known points and ~300 random points, decode the
     tile pixel and compare with an independently computed reference: bilinear
     samples of the source grid at the maxzoom pixel centres below that pixel,
     reduced by repeated NaN-aware 2x2 means (the pyramid scheme). Must agree
     within scale/2 (quantisation only).
  3. Independent source check: compare the decoded value at the query point
     with the value read straight from the source (EMAG2 GeoTIFF node via
     rasterio; EGM2008 via direct spherical-harmonic synthesis at the point).
     The source is evaluated at the centre of the tile pixel containing the
     point, so differences are interpolation only (bilinear between 2' nodes for
     EMAG2 vs nearest node; bilinear on the 2.46' synthesis grid for EGM2008).
Vector files: structure, value domains, antimeridian, point-in-polygon.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import math
import random
import sys

import numpy as np
from PIL import Image
from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import Compression, TileType

from .config import DERIVED_DIR
from .encode import decode_rgb
from .paths import OUT_DIR
from .tiles import (PMTILES_ZOOM_OFFSET, Grid, level_tile_count, lonlat_to_tile_pixel, pixel_centres,
                    pyramid_reference, tile_cols, tile_rows)

BUDGET_BYTES = 450_000_000

KNOWN_POINTS = {
    "magnetic": [
        ("Bangui anomaly (C.A.R.)", 18.5, 5.5),
        ("Kursk anomaly (Russia)", 36.5, 51.5),
        ("Guelph, Ontario", -80.25, 43.55),
        ("Mid-Atlantic Ridge 30N", -42.0, 30.0),
        ("Antimeridian 179.99E, 0N", 179.99, 0.0),
        ("Antimeridian 179.99W, 0N", -179.99, 0.0),
        ("Arctic Ocean 0E, 89.5N", 0.0, 89.5),
        ("Antarctica 100E, 75S", 100.0, -75.0),
    ],
    "gravity": [
        ("Puerto Rico Trench", -66.5, 19.8),
        ("Mariana Trench", 142.2, 11.35),
        ("Hawaii (Big Island)", -155.5, 19.6),
        ("Kansas (flat interior)", -98.0, 38.5),
        ("Guelph, Ontario", -80.25, 43.55),
        ("Antimeridian 179.99E, 0N", 179.99, 0.0),
        ("Near North Pole 0E, 89.9N", 0.0, 89.9),
        ("Near South Pole 0E, 89.9S", 0.0, -89.9),
    ],
}
EXTREME_BOXES = {
    "magnetic": [("Bangui", 14, 24, 0, 10), ("Kursk", 34, 40, 49, 54)],
    "gravity": [("Puerto Rico Trench", -70, -62, 18, 22)],
}


class Report:
    def __init__(self):
        self.failures: list[str] = []

    def check(self, ok: bool, msg: str) -> None:
        print(("  ok    " if ok else "  FAIL  ") + msg)
        if not ok:
            self.failures.append(msg)


def _tile_values(reader: Reader, z: int, x: int, y: int, scale: float, offset: float, cache: dict):
    key = (z, x, y)
    if key not in cache:
        data = reader.get(z + PMTILES_ZOOM_OFFSET, x, y)
        if data is None:
            cache[key] = None
        else:
            img = Image.open(io.BytesIO(data))
            assert img.mode == "RGB" and img.size == (256, 256), (img.mode, img.size)
            cache[key] = decode_rgb(np.asarray(img), scale, offset)
    return cache[key]


def decode_at(reader, lon, lat, z, scale, offset, cache):
    x, y, col, row = lonlat_to_tile_pixel(lon, lat, z)
    vals = _tile_values(reader, z, x, y, scale, offset, cache)
    lons, lats = pixel_centres(z, x, y)
    return (None if vals is None else float(vals[row, col])), float(lons[col]), float(lats[row])


def _independent_source(layer_id: str):
    """Return f(lon[], lat[]) -> values straight from the original source."""
    if layer_id == "magnetic":
        import rasterio
        from .config import load_config
        from .paths import RAW_DIR
        cfg = load_config("magnetic")
        ds = rasterio.open(RAW_DIR / cfg["source"]["filename"])
        nd = ds.nodata

        def f(lons, lats):
            pts = [((lo % 360.0), la) for lo, la in zip(lons, lats)]
            out = []
            for v in ds.sample(pts):
                out.append(float("nan") if v[0] == nd else float(v[0]))
            return np.array(out)
        return f, "EMAG2 GeoTIFF nearest node (rasterio)"
    if layer_id == "gravity":
        import pyshtools as pysh
        from .config import load_config
        from .layers.gravity import WGS84_A, WGS84_F, normal_zonal_coeffs
        from .paths import RAW_DIR
        from .tiles import geodetic_to_geocentric
        cfg = load_config("gravity")
        lmax = cfg["lmax"]
        clm = pysh.SHGravCoeffs.from_file(str(RAW_DIR / cfg["source"]["filename"]), format="icgem",
                                          lmax=lmax, encoding="utf-8")
        gm, r0 = float(clm.gm), float(clm.r0)
        base = np.array(clm.coeffs)
        for l, cn in normal_zonal_coeffs(gm, r0).items():
            base[0, l, 0] -= cn
        base[:, 0:2, :] = 0.0
        ls = np.arange(lmax + 1, dtype=np.float64)
        b = WGS84_A * (1 - WGS84_F)

        def f(lons, lats):
            out = []
            for lo, la in zip(lons, lats):
                psi = float(geodetic_to_geocentric(np.array([la]))[0])
                p = math.radians(psi)
                r = WGS84_A * b / math.sqrt((b * math.cos(p)) ** 2 + (WGS84_A * math.sin(p)) ** 2)
                k = gm / r ** 2 * (ls - 1.0) * (r0 / r) ** ls
                c = pysh.SHCoeffs.from_array(base * k[None, :, None], normalization="4pi", csphase=1)
                out.append(float(c.expand(lat=psi, lon=lo % 360.0, degrees=True)) * 1e5)
            return np.array(out)
        return f, "EGM2008 direct spherical-harmonic synthesis at the point"
    raise KeyError(layer_id)


def verify_raster(entry: dict, rep: Report) -> None:
    lid = entry["id"]
    path = OUT_DIR / entry["file"]
    print(f"\n== {lid}: {path.name} ({path.stat().st_size / 1e6:.1f} MB)")
    f = open(path, "rb")
    src = MmapSource(f)
    reader = Reader(src)
    h = reader.header()
    meta = reader.metadata()
    rep.check(h["tile_type"] == TileType.PNG, "tile type PNG")
    rep.check(h["tile_compression"] == Compression.NONE, "tile compression none")
    off = entry["pmtilesZoomOffset"]
    rep.check(entry.get("tiling") == "geographic" and off == PMTILES_ZOOM_OFFSET, "tiling geographic, pmtilesZoomOffset 1")
    rep.check(h["min_zoom"] == entry["minzoom"] + off and h["max_zoom"] == entry["maxzoom"] + off,
              f"PMTiles zoom range {h['min_zoom']}..{h['max_zoom']} = geographic levels "
              f"{entry['minzoom']}..{entry['maxzoom']} + {off}")
    # levelGain and pixelStep are measured from the finished archive, so they exist only in layers.json.
    derived = {"levelGain", "pixelStep"}
    rep.check(meta == {k: v for k, v in entry.items() if k not in derived}, "PMTiles metadata == layers.json entry")
    expected = sum(level_tile_count(z) for z in range(entry["minzoom"], entry["maxzoom"] + 1))
    rep.check(h["addressed_tiles_count"] == expected,
              f"{h['addressed_tiles_count']} tiles addressed (expected sum 2^(z+1)*2^z = {expected})")
    sizes: dict[int, int] = {}
    seen: set = set()
    bad = 0
    for (pz, x, y), data in all_tiles(src):
        z = pz - off
        if not (entry["minzoom"] <= z <= entry["maxzoom"] and 0 <= x < tile_cols(z) and 0 <= y < tile_rows(z)):
            bad += 1
        seen.add((z, x, y))
        sizes[z] = sizes.get(z, 0) + len(data)
    rep.check(bad == 0 and len(seen) == expected, f"every geographic tile present exactly once, none outside the scheme ({bad} bad)")
    print("  PNG bytes per geographic level: " + ", ".join(f"L{z} {sizes[z] / 1e6:.1f} MB" for z in sorted(sizes)))

    scale, offset = entry["scale"], entry["offset"]
    grid = Grid.load(DERIVED_DIR / f"{lid}_grid")
    cache: dict = {}
    zmax = entry["maxzoom"]

    # 2. encoding / tiling check at pixel centres
    rnd = random.Random(42)
    pts = [(lo, la) for _, lo, la in KNOWN_POINTS[lid]]
    pts += [(rnd.uniform(-180, 180), math.degrees(math.asin(rnd.uniform(-1.0, 1.0)))) for _ in range(300)]
    pts += [(lo, la) for lo in (-179.999, 0.0, 179.999) for la in (89.999, 89.97, -89.97, -89.999)]  # pole rows
    worst = 0.0
    nodata_mismatch = 0
    n = 0
    for z in (0, 3, zmax - 1, zmax):
        for lo, la in pts:
            v, plon, plat = decode_at(reader, lo, la, z, scale, offset, cache)
            x, y, col, row = lonlat_to_tile_pixel(lo, la, z)
            ref = pyramid_reference(grid, z, x, y, col, row, zmax)
            if v is None or (math.isnan(v) != math.isnan(ref)):
                nodata_mismatch += 1
                continue
            if not math.isnan(v):
                worst = max(worst, abs(v - ref))
                n += 1
    rep.check(worst <= scale / 2 + 1e-6 and nodata_mismatch == 0,
              f"decoded tiles vs pyramid reference (bilinear at L{zmax} pixel centres, 2x2 means below) ({n} samples, L0/L3/L{zmax - 1}/L{zmax}): "
              f"max |diff| {worst:.4f} {entry['units']} (quantisation limit {scale / 2}); nodata mismatches {nodata_mismatch}")

    # 3. independent source comparison at the known points
    fsrc, label = _independent_source(lid)
    known = KNOWN_POINTS[lid]
    centres = [decode_at(reader, lo, la, zmax, scale, offset, cache)[1:] for _, lo, la in known]
    srcv = fsrc([c[0] for c in centres], [c[1] for c in centres])
    print(f"  known points: tile value (level {zmax}) vs {label}, both at the containing pixel's centre:")
    tol = {"magnetic": 60.0, "gravity": 15.0}[lid]
    for (name, lo, la), sv in zip(known, srcv):
        v, _, _ = decode_at(reader, lo, la, zmax, scale, offset, cache)
        d = v - sv if (v is not None and not math.isnan(v) and not math.isnan(sv)) else float("nan")
        ok = math.isnan(d) and (v is None or math.isnan(v)) == math.isnan(sv) or abs(d) <= tol
        rep.check(bool(ok), f"{name:28s} ({lo:8.3f},{la:7.3f}) tile {v:9.1f}  source {sv:9.1f}  diff {d:7.2f} {entry['units']}")

    # local extremes
    for name, lo0, lo1, la0, la1 in EXTREME_BOXES[lid]:
        s = grid.spec
        lats = s.lat0 + np.arange(s.nrows) * s.dlat
        rows = np.where((lats >= la0) & (lats <= la1))[0]
        lons = (s.lon0 + np.arange(s.ncols) * s.dlon + 180) % 360 - 180
        cols = np.where((lons >= lo0) & (lons <= lo1))[0]
        sub = np.asarray(grid.data[np.ix_(rows, cols)], dtype=np.float64)
        i, j = np.unravel_index(np.nanargmax(np.abs(sub)), sub.shape)
        elon, elat = float(lons[cols[j]]), float(lats[rows[i]])
        if s.geocentric:  # grid rows are geocentric; convert back to geodetic for the query
            elat = math.degrees(math.atan(math.tan(math.radians(elat)) / (1 - 6.69437999014e-3)))
        v, plon, plat = decode_at(reader, elon, elat, zmax, scale, offset, cache)
        sv = float(fsrc([plon], [plat])[0])
        rep.check(abs(v - sv) <= tol, f"{name} extreme at ({elon:.3f},{elat:.3f}): grid node {sub[i, j]:.1f}, "
                  f"tile {v:.1f}, source {sv:.1f} {entry['units']}")
    f.close()


def ray_cast(lon: float, lat: float, ring: list) -> bool:
    inside = False
    n = len(ring)
    for i in range(n - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        if (y1 > lat) != (y2 > lat):
            xi = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < xi:
                inside = not inside
    return inside


def plate_at(lon: float, lat: float, polys: dict) -> list[str]:
    hits = []
    for f in polys["features"]:
        for poly in f["geometry"]["coordinates"]:
            if ray_cast(lon, lat, poly[0]) and not any(ray_cast(lon, lat, h) for h in poly[1:]):
                hits.append(f["properties"]["code"])
                break
    return hits


def verify_plates(entry: dict, rep: Report) -> None:
    print(f"\n== plates: {entry['file']}, {entry['polygons']}")
    lines = json.loads((OUT_DIR / entry["file"]).read_text())
    polys = json.loads((OUT_DIR / entry["polygons"]).read_text())
    types = set(entry["typeValues"])
    bad_type = sum(1 for f in lines["features"] if f["properties"]["type"] not in types)
    rep.check(bad_type == 0, f"{len(lines['features'])} boundary lines, all types in {sorted(types)}")
    jumps = sum(1 for f in lines["features"] for a, b in zip(f["geometry"]["coordinates"], f["geometry"]["coordinates"][1:])
                if abs(a[0] - b[0]) > 180)
    rep.check(jumps == 0, "no boundary segment jumps across the antimeridian")
    dp = all(round(c, 3) == c for f in lines["features"] for p in f["geometry"]["coordinates"] for c in p)
    rep.check(dp, "boundary coordinates rounded to 3 dp")
    rep.check(all(len(f["properties"]["plates"]) == 2 and all(f["properties"]["plates"]) for f in lines["features"]),
              "every boundary has two plate names")
    names = {f["properties"]["code"]: f["properties"]["name"] for f in polys["features"]}
    rep.check(len(names) == 52, f"{len(names)} plate polygons (PB2002 has 52 plates)")
    tests = [("Guelph", -80.25, 43.55, "NA"), ("Honolulu", -157.86, 21.31, "PA"), ("South Pole", 0, -89.9, "AN"),
             ("North Pole", 0, 89.9, "NA"), ("Nairobi", 36.82, -1.29, "SO"), ("Paris", 2.35, 48.86, "EU"),
             ("Fiji 179.9E", 179.9, -17.0, None), ("Lima", -77.04, -12.05, "SA"), ("Sydney", 151.2, -33.87, "AU")]
    for name, lo, la, want in tests:
        got = plate_at(lo, la, polys)
        ok = len(got) == 1 and (want is None or got[0] == want)
        rep.check(ok, f"point-in-polygon {name:12s} -> {[names[g] for g in got]}")
    rnd = random.Random(7)
    counts = {0: 0, 1: 0, 2: 0}
    n = 3000
    for _ in range(n):
        lo = rnd.uniform(-180, 180)
        la = math.degrees(math.asin(rnd.uniform(-1, 1)))
        k = min(len(plate_at(lo, la, polys)), 2)
        counts[k] += 1
    rep.check(counts[1] / n >= 0.995, f"random sphere points in exactly one plate: {counts[1]}/{n} "
              f"(none: {counts[0]}, several: {counts[2]})")


def verify_deposits(entry: dict, rep: Report) -> None:
    p = OUT_DIR / entry["file"]
    raw = p.read_bytes()
    gz = len(gzip.compress(raw, mtime=0))
    print(f"\n== deposits: {p.name} ({len(raw) / 1e6:.2f} MB, {gz / 1e6:.2f} MB gzipped)")
    d = json.loads(raw)
    rep.check(d["fields"] == ["lon", "lat", "name", "commodities", "status", "source", "sourceId"], "fields")
    rep.check(d["statusValues"] == ["producer", "past producer", "prospect", "occurrence"], "statusValues")
    ns, nst = len(d["sources"]), len(d["statusValues"])
    ok = all(len(r) == 7 and -180 <= r[0] <= 180 and -90 <= r[1] <= 90 and 0 <= r[4] < nst and 0 <= r[5] < ns
             and round(r[0], 4) == r[0] and round(r[1], 4) == r[1] for r in d["rows"])
    rep.check(ok, f"{len(d['rows'])} rows well-formed")
    ids = [(r[5], r[6]) for r in d["rows"]]
    rep.check(len(ids) == len(set(ids)), "source ids unique")
    rep.check(gz <= 4 * 1024 * 1024, "gzipped size <= 4 MB")
    for i, s in enumerate(d["sources"]):
        c = {}
        for r in d["rows"]:
            if r[5] == i:
                c[d["statusValues"][r[4]]] = c.get(d["statusValues"][r[4]], 0) + 1
        print(f"  {s['id']}: {c}")


def verify_places(entry: dict, rep: Report) -> None:
    p = OUT_DIR / entry["file"]
    d = json.loads(p.read_text())
    print(f"\n== places: {p.name} ({p.stat().st_size / 1e6:.2f} MB)")
    rep.check(d["fields"] == ["name", "admin1", "country", "lat", "lon", "pop"], "fields")
    rep.check(all(len(r) == 6 and -90 <= r[3] <= 90 and -180 <= r[4] <= 180 for r in d["rows"]),
              f"{len(d['rows'])} rows well-formed")
    g = [r for r in d["rows"] if r[0] == "Guelph"]
    rep.check(bool(g) and g[0][1] == "Ontario" and g[0][2] == "Canada", f"Guelph row: {g[:1]}")


def main() -> int:
    rep = Report()
    layers_path = OUT_DIR / "layers.json"
    doc = json.loads(layers_path.read_text())
    print(f"layers.json: version {doc['version']}, generated {doc['generated']}, "
          f"layers {[layer['id'] for layer in doc['layers']]}")
    total = layers_path.stat().st_size
    for e in doc["layers"]:
        for key in ("file", "polygons"):
            if key in e:
                fp = OUT_DIR / e[key]
                rep.check(fp.exists(), f"{e[key]} exists")
                total += fp.stat().st_size
    for e in doc["layers"]:
        if e["kind"] == "raster-value":
            verify_raster(e, rep)
        elif e["id"] == "plates":
            verify_plates(e, rep)
        elif e["id"] == "deposits":
            verify_deposits(e, rep)
        elif e["id"] == "places":
            verify_places(e, rep)
    print("\n== outputs")
    for fp in sorted(OUT_DIR.iterdir()):
        if fp.is_file():
            h = hashlib.sha256(fp.read_bytes()).hexdigest()
            print(f"  {fp.name:28s} {fp.stat().st_size:>12,d} bytes  sha256 {h[:16]}")
    rep.check(total <= BUDGET_BYTES, f"total deliverables {total / 1e6:.1f} MB (budget {BUDGET_BYTES / 1e6:.0f} MB)")
    print(f"\n{'PASS' if not rep.failures else 'FAIL'}: {len(rep.failures)} failure(s)")
    for m in rep.failures:
        print("  - " + m)
    return 0 if not rep.failures else 1


if __name__ == "__main__":
    sys.exit(main())
