"""GeoNames cities15000 + country and admin1 names -> places.v1.json.

Rows are sorted by population (descending), then name, so the client can
stop at the first matches for a prefix search. Display names are kept as-is
(UTF-8); ASCII folding for search is done client-side.
"""
from __future__ import annotations

import csv
import io
import json
import zipfile

from ..config import load_config
from ..fetch import fetch
from ..manifest import vector_layer_entry, write_layer_entry
from ..paths import OUT_DIR

csv.field_size_limit(10_000_000)


def build() -> dict:
    cfg = load_config("places")
    s = cfg["sources"]
    lic = cfg["licence"]
    cities = fetch(s["cities"]["url"], s["cities"]["filename"], licence=lic)
    countries_p = fetch(s["countries"]["url"], s["countries"]["filename"], licence=lic)
    admin1_p = fetch(s["admin1"]["url"], s["admin1"]["filename"], licence=lic)

    countries = {}
    for line in countries_p.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        countries[parts[0]] = parts[4]
    admin1 = {}
    for line in admin1_p.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            admin1[parts[0]] = parts[1]

    rows = []
    with zipfile.ZipFile(cities) as z:
        with z.open("cities15000.txt") as fh:
            for r in csv.reader(io.TextIOWrapper(fh, encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE):
                name, lat, lon, cc, a1, pop = r[1], float(r[4]), float(r[5]), r[8], r[10], int(r[14] or 0)
                rows.append([name, admin1.get(f"{cc}.{a1}", ""), countries.get(cc, cc),
                             round(lat, 3), round(lon, 3), pop])
    rows.sort(key=lambda x: (-x[5], x[0], x[2], x[1], x[3], x[4]))
    doc = {"fields": ["name", "admin1", "country", "lat", "lon", "pop"], "rows": rows}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / cfg["file"]
    out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    write_layer_entry(vector_layer_entry(cfg, {"count": len(rows)}))
    print(f"[places] {len(rows)} places, {out.stat().st_size / 1e6:.2f} MB")
    return {"rows": len(rows), "bytes": out.stat().st_size}
