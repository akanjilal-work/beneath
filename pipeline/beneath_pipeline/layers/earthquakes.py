"""USGS ComCat earthquakes -> earthquakes.v1.json (compact, flat numeric array).

Source
- USGS ANSS Comprehensive Catalog through the FDSN event service (public domain).
  One CSV per calendar year, so every request stays far below the service's
  20,000-event limit (the busiest year, 2011, has about 2,700 events at M5+).
  The last request ends at the fixed `end` date in the config, so a rebuild asks
  for exactly the same window.

Filtering
- Magnitude >= minMagnitude and event type "earthquake" (no explosions or quarry
  blasts). Rows without a depth are dropped; the depth is the point of the layer.

Output
- `data` is a flat array with stride 5: lon, lat, depth in km (positive down),
  magnitude, and days since 1970-01-01 (UTC). Coordinates are rounded to 0.01 deg
  (about 1 km), depth and magnitude to 0.1.
- `names` maps a row index to the catalogue's place name for large events only,
  which keeps the file small while the famous earthquakes still have a label.
"""
from __future__ import annotations

import csv
import datetime as dt
import gzip
import json
from urllib.parse import urlencode

from ..config import load_config
from ..fetch import fetch
from ..manifest import vector_layer_entry, write_layer_entry
from ..paths import OUT_DIR

STRIDE = 5
EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)


def _num(v: float, nd: int) -> float | int:
    r = round(v, nd)
    return int(r) if r == int(r) else r


def year_windows(start_year: int, end: str) -> list[tuple[str, str]]:
    """Calendar-year [start, end) windows from start_year up to the fixed end date."""
    stop = dt.date.fromisoformat(end)
    out = []
    y = start_year
    while dt.date(y, 1, 1) < stop:
        nxt = min(dt.date(y + 1, 1, 1), stop)
        out.append((dt.date(y, 1, 1).isoformat(), nxt.isoformat()))
        y += 1
    return out


def parse_rows(text: str, min_mag: float) -> list[dict]:
    rows = []
    for r in csv.DictReader(text.splitlines()):
        if r.get("type", "earthquake") != "earthquake":
            continue
        try:
            lon, lat, mag = float(r["longitude"]), float(r["latitude"]), float(r["mag"])
            depth = float(r["depth"])
        except (KeyError, ValueError):
            continue
        if mag < min_mag:
            continue
        t = dt.datetime.fromisoformat(r["time"].replace("Z", "+00:00"))
        rows.append({
            "lon": lon, "lat": lat, "depth": max(0.0, depth), "mag": mag,
            "days": (t - EPOCH).days, "time": r["time"], "id": r.get("id", ""), "place": r.get("place", ""),
        })
    return rows


def compact(rows: list[dict], named_from: float) -> dict:
    rows = sorted(rows, key=lambda r: (r["time"], r["id"]))
    data: list[float | int] = []
    names: dict[str, str] = {}
    for i, r in enumerate(rows):
        data += [_num(r["lon"], 2), _num(r["lat"], 2), _num(r["depth"], 1), _num(r["mag"], 1), r["days"]]
        if r["mag"] >= named_from and r["place"]:
            names[str(i)] = r["place"]
    return {"stride": STRIDE, "fields": ["lon", "lat", "depthKm", "mag", "days"], "epoch": "1970-01-01",
            "count": len(rows), "data": data, "names": names}


def build() -> dict:
    cfg = load_config("earthquakes")
    q = cfg["query"]
    rows: list[dict] = []
    for start, end in year_windows(q["startYear"], q["end"]):
        params = {"format": "csv", "starttime": start, "endtime": end, "minmagnitude": q["minMagnitude"],
                  "eventtype": "earthquake", "orderby": "time-asc"}
        path = fetch(f"{q['url']}?{urlencode(params)}", f"usgs-comcat-m{q['minMagnitude']}-{start[:4]}.csv",
                     licence=cfg["licence"])
        rows += parse_rows(path.read_text(encoding="utf-8"), q["minMagnitude"])

    # A few events sit exactly on a window edge; keep one copy per catalogue id.
    seen: set[str] = set()
    unique = [r for r in rows if not (r["id"] in seen or seen.add(r["id"]))]
    doc = compact(unique, q["namedFromMagnitude"])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
    (OUT_DIR / cfg["file"]).write_text(raw)
    mags = [r["mag"] for r in unique]
    entry = vector_layer_entry(cfg, {
        "count": doc["count"], "minMagnitude": q["minMagnitude"], "start": f"{q['startYear']}-01-01", "end": q["end"],
        "maxMagnitude": max(mags) if mags else None,
    })
    write_layer_entry(entry)
    gz = len(gzip.compress(raw.encode()))
    print(f"[earthquakes] {doc['count']} events, {len(doc['names'])} named, "
          f"{len(raw) / 1e6:.2f} MB ({gz / 1e6:.2f} MB gzipped)")
    return entry
