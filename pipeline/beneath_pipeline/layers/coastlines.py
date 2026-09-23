"""Natural Earth 1:50m coastlines -> coastlines.v1.geojson.

Drawn over the data layers so people can tell where they are when a raster
covers the base map. Coordinates are rounded to 0.01 deg (about 1 km), which is
finer than the 1:50m source, and repeated points are dropped.
"""
from __future__ import annotations

import json

from ..config import load_config
from ..fetch import fetch
from ..manifest import vector_layer_entry, write_layer_entry
from ..paths import OUT_DIR

ND = 2


def compact(source: dict) -> dict:
    features = []
    for f in source["features"]:
        g = f["geometry"]
        lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        for line in lines:
            out: list[list[float]] = []
            for x, y in line:
                p = [round(x, ND), round(y, ND)]
                if not out or out[-1] != p:
                    out.append(p)
            if len(out) > 1:
                features.append({"type": "Feature", "properties": {}, "geometry": {"type": "LineString", "coordinates": out}})
    return {"type": "FeatureCollection", "features": features}


def build() -> dict:
    cfg = load_config("coastlines")
    src = cfg["sources"]["coastline"]
    path = fetch(src["url"], src["filename"], licence=cfg["licence"])
    doc = compact(json.loads(path.read_text(encoding="utf-8")))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / cfg["file"]).write_text(json.dumps(doc, separators=(",", ":")))
    entry = vector_layer_entry(cfg, {"count": len(doc["features"])})
    write_layer_entry(entry)
    print(f"[coastlines] {len(doc['features'])} lines")
    return entry
