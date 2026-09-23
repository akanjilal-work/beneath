"""Load per-dataset configs from pipeline/configs/."""
from __future__ import annotations

import json

from .paths import CONFIG_DIR, RAW_DIR

DERIVED_DIR = RAW_DIR / "derived"  # intermediate grids + layer entries (gitignored)

LAYER_ORDER = ["magnetic", "gravity", "plates", "deposits", "places", "coastlines"]


def load_config(layer_id: str) -> dict:
    return json.loads((CONFIG_DIR / f"{layer_id}.json").read_text())


def build_config() -> dict:
    return json.loads((CONFIG_DIR / "build.json").read_text())
