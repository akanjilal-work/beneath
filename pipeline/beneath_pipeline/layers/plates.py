"""PB2002 (Bird 2003) plate boundaries and plate polygons.

plates.v1.geojson
    LineStrings built from PB2002 *steps* (the per-digitisation-step table),
    because the boundary class codes (SUB, OSR, OTF, OCB, CRB, CTF, CCB) are
    defined per step, not per boundary. Consecutive steps of the same boundary
    with the same class and touching end points are merged into one line.
    Each step is a great-circle arc of at most ~110 km in the original model,
    so the lines keep only the original step end points (0.001 deg precision);
    the densified vertices in the GeoJSON conversion are dropped.
    Properties: type (step class), name (PB2002 boundary identifier, e.g.
    "AF-AN", "NZ\\SA"), plates ([left plate name, right plate name]).
    No line crosses the antimeridian: steps crossing it are already split at
    +-180 in the source, and a jump in longitude always starts a new line.

plate-polygons.v1.geojson
    One feature per plate code (MultiPolygon), properties code, name.
    Rings are plain lon/lat with longitudes in [-180, 180]; plates crossing the
    antimeridian are split into parts at +-180, and the two polar-cap plates
    (AN, NA) are closed along the pole (lat = +-90) and the +-180 meridian, so a
    planar even-odd ray-casting test in lon/lat works without special cases.
"""
from __future__ import annotations

import json
from collections import OrderedDict

from ..config import load_config
from ..fetch import fetch
from ..manifest import vector_layer_entry, write_layer_entry
from ..paths import OUT_DIR

ND = 3  # decimal places


def _r(p):
    return [round(p[0], ND), round(p[1], ND)]


def _dedupe(coords):
    out = []
    for p in coords:
        if not out or p != out[-1]:
            out.append(p)
    return out


def plate_names(plates_geojson: dict) -> dict[str, str]:
    names: dict[str, str] = {}
    for f in plates_geojson["features"]:
        names[f["properties"]["Code"]] = f["properties"]["PlateName"]
    return names


def split_boundary_name(name: str) -> tuple[str, str, str]:
    for sep in ("-", "/", "\\"):
        if sep in name:
            a, b = name.split(sep)
            return a, sep, b
    raise ValueError(name)


def build_boundaries(steps: dict, names: dict[str, str]) -> dict:
    def order(f):
        # steps split at the antimeridian appear as two features with one SEQNUM;
        # the piece that starts at the step's start point comes first
        p = f["properties"]
        x0, y0 = f["geometry"]["coordinates"][0]
        sx = ((p["STARTLONG"] + 180.0) % 360.0) - 180.0
        starts_here = abs(y0 - p["STARTLAT"]) < 1e-3 and (abs(x0 - sx) < 1e-3 or abs(abs(x0) - 180) < 1e-3 and abs(abs(sx) - 180) < 1e-3)
        return (p["SEQNUM"], 0 if starts_here else 1)

    feats = sorted(steps["features"], key=order)
    lines = []  # (props, coords)
    for f in feats:
        p = f["properties"]
        c = f["geometry"]["coordinates"]
        a, b = _r(c[0]), _r(c[-1])
        key = (p["PLATEBOUND"], p["STEPCLASS"])
        if lines and lines[-1][0] == key and lines[-1][1][-1] == a:
            lines[-1][1].append(b)
        else:
            lines.append((key, [a, b]))
    out = []
    for (bname, cls), coords in lines:
        coords = _dedupe(coords)
        if len(coords) < 2:
            continue
        left, _sep, right = split_boundary_name(bname)
        out.append({
            "type": "Feature",
            "properties": {"type": cls, "name": bname,
                           "plates": [names.get(left, left), names.get(right, right)]},
            "geometry": {"type": "LineString", "coordinates": coords},
        })
    return {"type": "FeatureCollection", "features": out}


def build_polygons(plates: dict) -> dict:
    by_code: "OrderedDict[str, dict]" = OrderedDict()
    for f in plates["features"]:
        code = f["properties"]["Code"]
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        entry = by_code.setdefault(code, {"name": f["properties"]["PlateName"], "polys": []})
        for poly in polys:
            rings = []
            for ring in poly:
                r = _dedupe([_r(p) for p in ring])
                if r[0] != r[-1]:
                    r.append(r[0])
                if len(r) >= 4:
                    rings.append(r)
            if rings:
                entry["polys"].append(rings)
    feats = []
    for code in sorted(by_code):
        e = by_code[code]
        for poly in e["polys"]:
            for ring in poly:
                for i in range(1, len(ring)):
                    if abs(ring[i][0] - ring[i - 1][0]) > 180 and abs(abs(ring[i][1]) - 90) > 1e-9:
                        raise ValueError(f"{code}: ring jumps across the antimeridian away from a pole")
        feats.append({
            "type": "Feature",
            "properties": {"code": code, "name": e["name"]},
            "geometry": {"type": "MultiPolygon", "coordinates": e["polys"]},
        })
    return {"type": "FeatureCollection", "features": feats}


def _dump(obj) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def build() -> dict:
    cfg = load_config("plates")
    srcs = cfg["sources"]
    lic = cfg["licence"]
    steps = json.loads(fetch(srcs["steps"]["url"], srcs["steps"]["filename"], licence=lic).read_text())
    plates = json.loads(fetch(srcs["plates"]["url"], srcs["plates"]["filename"], licence=lic).read_text())
    names = plate_names(plates)
    lines = build_boundaries(steps, names)
    polys = build_polygons(plates)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / cfg["file"]).write_text(_dump(lines))
    (OUT_DIR / cfg["polygons"]).write_text(_dump(polys))
    entry = vector_layer_entry(cfg, {"typeValues": cfg["typeValues"]})
    write_layer_entry(entry)
    counts: dict[str, int] = {}
    for f in lines["features"]:
        counts[f["properties"]["type"]] = counts.get(f["properties"]["type"], 0) + 1
    print(f"[plates] {len(lines['features'])} boundary lines {counts}; {len(polys['features'])} plates")
    return {"lines": len(lines["features"]), "byType": counts, "plates": len(polys["features"])}
