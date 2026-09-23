"""Mineral deposits -> deposits.v1.json (compact columnar).

Sources
- USGS MRDS (public domain, legacy: not updated since 2011). Kept statuses:
  Producer, Past Producer, Prospect (Occurrence / Unknown / Plant dropped).
- NRCan 900A "Principal Mineral Areas, Producing Mines, and Oil and Gas Fields"
  (Open Government Licence - Canada): metal, non-metal and coal mines, all
  status "producer". Queried from the NRCan ArcGIS REST service as GeoJSON.

Commodities
- MRDS: commod1 (primary) then commod2 (secondary); commod3 (tertiary) only when
  both are empty. Metals and a few groups are shortened to element symbols /
  short codes; qualifier words that MRDS appends after a comma ("Sand and
  Gravel, Construction", "Stone, Crushed/Broken") and after a hyphen
  ("Barium-Barite") are folded into one short name.
- Joined with ';', primary first, de-duplicated.

Dedupe
- MRDS: same rounded position (4 dp) and same normalised name -> keep the most
  advanced status (producer > past producer > prospect).
- NRCan vs MRDS: an MRDS record within 2 km of an NRCan mine with the same
  normalised name is dropped (NRCan is current).
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
import unicodedata
import zipfile

from ..config import load_config
from ..fetch import fetch
from ..manifest import vector_layer_entry, write_layer_entry
from ..paths import OUT_DIR

STATUS_VALUES = ["producer", "past producer", "prospect", "occurrence"]
FIELDS = ["lon", "lat", "name", "commodities", "status", "source", "sourceId"]

SYMBOLS = {
    "gold": "Au", "silver": "Ag", "copper": "Cu", "lead": "Pb", "zinc": "Zn", "iron": "Fe",
    "uranium": "U", "manganese": "Mn", "tungsten": "W", "vanadium": "V", "chromium": "Cr",
    "molybdenum": "Mo", "antimony": "Sb", "mercury": "Hg", "tin": "Sn", "aluminum": "Al",
    "aluminium": "Al", "platinum": "Pt", "nickel": "Ni", "arsenic": "As", "beryllium": "Be",
    "cobalt": "Co", "titanium": "Ti", "bismuth": "Bi", "iridium": "Ir", "zirconium": "Zr",
    "thorium": "Th", "osmium": "Os", "palladium": "Pd", "niobium (columbium)": "Nb", "niobium": "Nb",
    "tantalum": "Ta", "lithium": "Li", "tellurium": "Te", "cadmium": "Cd", "rhodium": "Rh",
    "ruthenium": "Ru", "selenium": "Se", "strontium": "Sr", "thallium": "Tl", "gallium": "Ga",
    "rhenium": "Re", "indium": "In", "germanium": "Ge", "cesium": "Cs", "caesium": "Cs",
    "rubidium": "Rb", "hafnium": "Hf", "scandium": "Sc", "cerium": "Ce", "yttrium": "Y",
    "magnesium": "Mg", "radium": "Ra", "helium": "He", "iodine": "I", "bromine": "Br",
    "potassium": "K", "sodium": "Na", "calcium": "Ca", "boron": "B", "fluorine": "F",
    "phosphorus": "P", "sulfur": "S", "sulphur": "S", "barium": "Ba", "chlorine": "Cl",
    "graphite": "Graphite", "rare earth elements": "REE", "rare earths": "REE", "ree": "REE",
    "platinum group metals": "PGE", "platinum group elements": "PGE", "pge": "PGE",
}
# MRDS "Commodity-Qualifier" forms -> short name
HYPHEN_FORMS = {
    "barium-barite": "Barite", "fluorine-fluorite": "Fluorite", "phosphorus-phosphates": "Phosphate",
    "gypsum-anhydrite": "Gypsum", "talc-soapstone": "Talc", "boron-borates": "Borates",
    "sulfur-pyrite": "Pyrite", "iron-pyrite": "Pyrite", "nitrogen-nitrates": "Nitrates",
    "titanium-heavy minerals": "Ti", "titanium-ilmenite": "Ti", "titanium-rutile": "Ti",
}
# tokens that qualify the preceding MRDS commodity after a comma; dropped
QUALIFIERS = {
    "construction", "crushed/broken", "dimension", "metal", "general", "high calcium", "ultra pure",
    "light weight", "free", "smelter", "refiner", "refinery", "contained or metal", "mill concentrate",
    "industrial", "industrial/frac sand", "pigment", "tailings",
}
RENAME = {"sand and gravel": "Sand & gravel", "stone": "Stone", "diamonds": "Diamond"}


def short_commodity(name: str) -> str:
    n = name.strip()
    k = n.lower()
    if k in HYPHEN_FORMS:
        return HYPHEN_FORMS[k]
    if k in SYMBOLS:
        return SYMBOLS[k]
    if k in RENAME:
        return RENAME[k]
    if "-" in n and n.split("-")[0].lower() in SYMBOLS:
        return SYMBOLS[n.split("-")[0].lower()]
    return n[:1].upper() + n[1:]


def mrds_commodities(*cols: str) -> list[str]:
    out: list[str] = []
    for col in cols:
        if not col:
            continue
        for tok in col.split(","):
            t = tok.strip()
            if not t or t.lower() in QUALIFIERS:
                continue
            s = short_commodity(t)
            if s not in out:
                out.append(s)
    return out


def nrcan_commodities(product: str) -> list[str]:
    out: list[str] = []
    product = re.sub(r"\([^)]*\)", "", product or "")  # "Coal (metallurgical, thermal)" -> "Coal"
    for tok in product.split(","):
        t = tok.strip()
        if not t:
            continue
        s = short_commodity(t)
        if s not in out:
            out.append(s)
    return out


def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(mine|mines|deposit|prospect|property|claims?|group|project|the|no\.?)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def load_mrds(cfg: dict) -> list[dict]:
    m = cfg["mrds"]
    path = fetch(m["url"], m["filename"], licence="Public domain (US Government)")
    keep = {s: STATUS_VALUES.index(s.lower()) for s in m["keepStatus"]}
    rows = []
    with zipfile.ZipFile(path) as z:
        with z.open("mrds.csv") as fh:
            reader = csv.DictReader(io.TextIOWrapper(fh, encoding="latin-1", newline=""))
            for r in reader:
                st = r["dev_stat"]
                if st not in keep:
                    continue
                try:
                    lat, lon = float(r["latitude"]), float(r["longitude"])
                except ValueError:
                    continue
                if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    continue
                name = (r["site_name"] or "").strip()
                if name.lower() in ("unknown", "unnamed", "unnamed prospect", "unnamed occurrence"):
                    name = ""
                com = mrds_commodities(r["commod1"], r["commod2"])
                if not com:
                    com = mrds_commodities(r["commod3"])
                rows.append({"lon": round(lon, 4), "lat": round(lat, 4), "name": name,
                             "commodities": ";".join(com), "status": keep[st],
                             "source": "mrds", "sourceId": r["dep_id"]})
    # dedupe: same position + same normalised name -> keep most advanced status, then lowest id
    rows.sort(key=lambda d: (d["lon"], d["lat"], norm_name(d["name"]), d["status"], int(d["sourceId"])))
    out, seen = [], set()
    for d in rows:
        k = (d["lon"], d["lat"], norm_name(d["name"]))
        if k in seen:
            continue
        seen.add(k)
        out.append(d)
    print(f"[deposits] MRDS kept {len(out)} of {len(rows)} (after dedupe)")
    return out


def load_nrcan(cfg: dict) -> list[dict]:
    n = cfg["nrcan900a"]
    rows = []
    for layer, label in sorted(n["layers"].items(), key=lambda kv: int(kv[0])):
        url = (f"{n['service']}/{layer}/query?where=1%3D1&outFields=*&returnGeometry=true"
               f"&outSR=4326&orderByFields=OBJECTID&f=geojson")
        path = fetch(url, f"nrcan_900A_{label}.geojson", licence="Open Government Licence - Canada 2.0")
        gj = json.loads(path.read_text())
        if gj.get("exceededTransferLimit"):
            raise RuntimeError(f"NRCan layer {layer}: transfer limit exceeded, add paging")
        for f in gj["features"]:
            p = f["properties"]
            lon, lat = f["geometry"]["coordinates"][:2]
            rows.append({"lon": round(lon, 4), "lat": round(lat, 4),
                         "name": (p.get("operation_name_en") or "").strip(),
                         "commodities": ";".join(nrcan_commodities(p.get("product_en_spelt"))),
                         "status": 0, "source": "nrcan-900a",
                         "sourceId": f"900A-{label}-{p['OBJECTID']}"})
        print(f"[deposits] NRCan 900A {label}: {len(gj['features'])}")
    return rows


def _km(a: dict, b: dict) -> float:
    dlat = math.radians(b["lat"] - a["lat"])
    dlon = math.radians(b["lon"] - a["lon"]) * math.cos(math.radians((a["lat"] + b["lat"]) / 2))
    return 6371.0 * math.hypot(dlat, dlon)


def build() -> dict:
    cfg = load_config("deposits")
    mrds = load_mrds(cfg)
    nrcan = load_nrcan(cfg)
    # cross-source dedupe (spatial hash on 0.1 deg cells)
    cells: dict[tuple[int, int], list[dict]] = {}
    for d in nrcan:
        cells.setdefault((math.floor(d["lon"] * 10), math.floor(d["lat"] * 10)), []).append(d)
    dropped = 0
    kept = []
    for d in mrds:
        cx, cy = math.floor(d["lon"] * 10), math.floor(d["lat"] * 10)
        dup = False
        nn = norm_name(d["name"])
        if nn:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for c in cells.get((cx + dx, cy + dy), []):
                        if norm_name(c["name"]) == nn and _km(c, d) <= 2.0:
                            dup = True
        if dup:
            dropped += 1
        else:
            kept.append(d)
    print(f"[deposits] dropped {dropped} MRDS records duplicated by NRCan 900A")

    sources = cfg["sources"]
    sidx = {s["id"]: i for i, s in enumerate(sources)}
    allrows = nrcan + kept
    allrows.sort(key=lambda d: (sidx[d["source"]], d["sourceId"]))
    doc = {
        "fields": FIELDS,
        "statusValues": STATUS_VALUES,
        "rows": [[d["lon"], d["lat"], d["name"], d["commodities"], d["status"], sidx[d["source"]], d["sourceId"]]
                 for d in allrows],
        "sources": [{k: s[k] for k in ("id", "name", "licence", "url", "legacy", "citation")} for s in sources],
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / cfg["file"]
    out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    counts: dict[str, dict[str, int]] = {}
    for d in allrows:
        c = counts.setdefault(d["source"], {})
        c[STATUS_VALUES[d["status"]]] = c.get(STATUS_VALUES[d["status"]], 0) + 1
    import gzip
    gz = len(gzip.compress(out.read_bytes(), mtime=0))
    print(f"[deposits] {len(allrows)} rows, {out.stat().st_size / 1e6:.2f} MB ({gz / 1e6:.2f} MB gzipped) {counts}")
    write_layer_entry(vector_layer_entry(cfg, {"count": len(allrows), "counts": counts}))
    return {"rows": len(allrows), "counts": counts, "bytes": out.stat().st_size, "gzipBytes": gz}
