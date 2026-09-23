"""Layer entries and the layers.json manifest the app reads first."""
from __future__ import annotations

import json

from .config import DERIVED_DIR, LAYER_ORDER, build_config
from .paths import OUT_DIR

COMMON_TAIL = ["attribution", "licence", "sourceUrl", "citation", "description"]


def _pick(cfg: dict, keys: list[str]) -> dict:
    return {k: cfg[k] for k in keys if k in cfg}


def raster_layer_entry(cfg: dict, *, scale: float, offset: float, data_min: float, data_max: float,
                       display_min: float, display_max: float) -> dict:
    e = {
        "id": cfg["id"],
        "name": cfg["name"],
        "kind": "raster-value",
        "file": cfg["file"],
        "units": cfg["units"],
        "scale": scale,
        "offset": offset,
        "tiling": "geographic",
        "pmtilesZoomOffset": 1,
        "minzoom": cfg["minzoom"],
        "maxzoom": cfg["maxzoom"],
        "tileSize": 256,
        "displayMin": display_min,
        "displayMax": display_max,
        "dataMin": data_min,
        "dataMax": data_max,
    }
    e.update(_pick(cfg, COMMON_TAIL))
    return e


def vector_layer_entry(cfg: dict, extra: dict | None = None) -> dict:
    e = _pick(cfg, ["id", "name", "kind", "file", "polygons"])
    if extra:
        e.update(extra)
    e.update(_pick(cfg, COMMON_TAIL))
    return e


def layer_entry_path(layer_id: str):
    return DERIVED_DIR / f"{layer_id}.entry.json"


def write_layer_entry(entry: dict) -> None:
    DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    layer_entry_path(entry["id"]).write_text(json.dumps(entry, indent=2, ensure_ascii=False))


def write_layers_json() -> dict:
    layers = []
    missing = []
    for lid in LAYER_ORDER:
        p = layer_entry_path(lid)
        if p.exists():
            layers.append(json.loads(p.read_text()))
        else:
            missing.append(lid)
    doc = {"version": 1, "generated": build_config()["generated"], "layers": layers}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "layers.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    if missing:
        print(f"[manifest] WARNING layers not built yet, omitted: {', '.join(missing)}")
    print(f"[manifest] wrote layers.json with {len(layers)} layers")
    return doc
