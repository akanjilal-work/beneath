# pipeline

Python data pipeline for Beneath: fetch sources, value-encode rasters into
geographic (EPSG:4326) PNG tiles packaged as PMTiles, and write the vector and point files
plus the `layers.json` manifest the app reads first. See
`docs/02-architecture.md` and `docs/03-data-sources.md`.

## Setup

```sh
cd pipeline
python3 -m venv .venv            # Python 3.11 or newer
.venv/bin/pip install -r requirements.txt
```

No GDAL CLI or tippecanoe is needed. rasterio's wheel bundles GDAL and pyshtools
does the spherical-harmonic synthesis.

## Commands

```sh
.venv/bin/python -m beneath_pipeline build all        # everything + layers.json (about 2 min on 10 cores, plus downloads)
.venv/bin/python -m beneath_pipeline build magnetic   # one layer (magnetic|gravity|plates|deposits|earthquakes|places|coastlines), rewrites layers.json
.venv/bin/python -m beneath_pipeline build gravity --force   # recompute the cached EGM2008 grid
.venv/bin/python -m beneath_pipeline build manifest   # only rewrite layers.json
.venv/bin/python -m beneath_pipeline verify           # check outputs against the sources
.venv/bin/python -m pytest -q tests
```

Downloads go to `sources/raw/` (gitignored, about 530 MB). Each download is
recorded in `sources/manifest.json` with its URL, sha256, size, download date
and licence. That file is committed. Intermediate grids and layer entries go to
`sources/raw/derived/`. Deliverables go to `out/` (gitignored).

Builds are deterministic: the same inputs give byte-identical outputs. Tiles
are written in tile-id order, tiles are de-duplicated by SHA-256, PNGs carry no
timestamps, and the `generated` date in `layers.json` comes from
`configs/build.json`. This was checked by rebuilding everything with `--force`
and comparing hashes.

## Layout

```
beneath_pipeline/
  fetch.py        download + sha256 + sources/manifest.json
  encode.py       value <-> 24-bit RGB encoding
  tiles.py        geographic tile math + PMTiles addressing, grid sampling (bilinear, antimeridian wrap), pyramid, PNG + PMTiles writing
  manifest.py     layer entries, layers.json
  verify.py       output checks
  layers/         one module per dataset (magnetic, gravity, plates, deposits, earthquakes, places, coastlines)
configs/          one JSON per dataset (source URL, units, scale, maxzoom, licence, attribution) + build.json
tests/            encode/decode round trip, tile math and addressing, interpolation/wrap, pyramid means
```

## Outputs (`out/`)

| File | Size | Notes |
|---|---|---|
| `layers.json` | 5 KB | manifest, read first by the app |
| `magnetic.v1.pmtiles` | 89.6 MB | geographic levels 0 to 5, 2,730 PNG tiles, scale 1 nT |
| `gravity.v1.pmtiles` | 146.7 MB | geographic levels 0 to 5, 2,730 PNG tiles, scale 0.1 mGal |
| `plates.v1.geojson` | 0.37 MB | 1,683 boundary lines |
| `plate-polygons.v1.geojson` | 0.21 MB | 52 plates |
| `deposits.v1.json` | 12.4 MB (3.74 MB gzipped) | 200,834 points |
| `earthquakes.v1.json` | 2.4 MB (0.82 MB gzipped) | 91,625 events, M5+ since 1970, with depth |
| `places.v1.json` | 2.0 MB | 34,146 places |
| `coastlines.v1.geojson` | 1.0 MB | 1,429 lines, Natural Earth 1:50m |
| **Total** | **254.6 MB** | budget 450 MB |

PNG bytes per geographic level (PMTiles zoom = level + 1):

| level | tiles (cols x rows) | pixel size | magnetic | gravity |
|---|---|---|---|---|
| 0 | 2 (2 x 1) | 42.2' | 0.19 MB | 0.20 MB |
| 1 | 8 (4 x 2) | 21.1' | 0.70 MB | 0.77 MB |
| 2 | 32 (8 x 4) | 10.5' | 2.42 MB | 2.87 MB |
| 3 | 128 (16 x 8) | 5.3' | 7.58 MB | 10.23 MB |
| 4 | 512 (32 x 16) | 2.6' | 21.50 MB | 33.35 MB |
| 5 | 2,048 (64 x 32) | 1.32' | 57.20 MB | 99.22 MB |

Level 5 pixels (1.32 arc-minutes, about 2.4 km) are finer than both sources
(EMAG2 2', EGM2008 synthesis grid 2.46'), so the app overzooms above level 5.

## Raster tile encoding

- Geographic (EPSG:4326, equirectangular) tiles, 256 x 256 px, matching
  Cesium's `GeographicTilingScheme`. Coverage is pole to pole.
  - Level z has 2^(z+1) columns x 2^z rows of tiles. x = 0 starts at lon -180
    and y = 0 starts at lat +90 (north).
  - Tile (z, x, y) covers lon [-180 + x*d, -180 + (x+1)*d] and lat
    [90 - (y+1)*d, 90 - y*d], with d = 180 / 2^z degrees.
  - The centre of pixel (col, row) is at lon = -180 + (256x + col + 0.5)*p and
    lat = 90 - (256y + row + 0.5)*p, with p = 180 / (256 * 2^z) degrees.
- **PMTiles addressing:** PMTiles tile ids assume 2^z x 2^z tiles per zoom, so
  geographic level z is stored at **PMTiles zoom z + 1** with the same x and y:
  `tileid = zxy_to_tileid(z + 1, x, y)`, i.e. `reader.getZxy(z + 1, x, y)` in
  pmtiles JS. Only the upper half (y < 2^z) of each PMTiles zoom is populated.
  The PMTiles header therefore reports min/max zoom 1..6, and its bounds are
  -180..180, -90..90. In `layers.json` each raster layer has
  `"tiling": "geographic"`, `"pmtilesZoomOffset": 1`, and
  `minzoom`/`maxzoom` given as geographic levels (0 and 5).
- PMTiles v3, tile type PNG, tile compression none. The PMTiles directories and
  metadata use the format's standard internal gzip.
- Pixels are 24-bit RGB PNG with no alpha. `raw = R*65536 + G*256 + B`,
  `value = raw*scale + offset`, and `raw == 0` means nodata. The offset is
  `-(2^23)*scale`, so value 0 maps to raw 2^23. Raw values are clipped to
  [1, 2^24-1].
- The tiles form a proper pyramid:
  - **maxzoom (level 5):** each pixel is a bilinear sample of the source
    lon/lat grid at the pixel centre. Columns wrap at 0/360, so there is no
    seam at +-180. Nodata neighbours are dropped and the remaining weights
    renormalised. A pixel becomes nodata when less than half of the bilinear
    weight is valid. Pixels beyond the source's first or last row are nodata,
    never extrapolated. For EMAG2 that means the rows poleward of +-89 deg 58'.
  - **Lower zooms:** each pixel is the NaN-aware 2x2 mean of its four children
    one level up (the mean of the valid children, nodata only if all four are
    nodata). This is area averaging, so low zooms do not alias.
  - The means are computed from the unquantised float32 values, and each level
    is quantised only when it is encoded. The float mosaics are temporary
    `.npy` memmaps in `sources/raw/derived/` and are deleted after the build.
- PMTiles metadata is identical to the layer's entry in `layers.json`, except
  for `levelGain`, which is measured from the finished archive.
- `displayMin`/`displayMax` are symmetric: +-(98th percentile of |value|),
  area-weighted (cos lat) over the full sphere and rounded to 2 significant
  figures. `dataMin`/`dataMax` are the source grid extremes.
- `levelGain[z]` is the 98th percentile of |value| at level 5 divided by the
  same at level z, capped to [1, 4]. It is sampled from up to 32 x 16 tiles
  per level. The app divides the display range by it so that the averaged low
  levels keep the same contrast.

### Magnetic (EMAG2v3, upward-continued)

- Source file `EMAG2_V3_20170530_UpCont.tif`: float32, 10800 x 5399, nodata
  `-3.4028235e38` (float32 lowest). About 3.1% of cells are nodata (gaps in the
  marine survey coverage).
- The file has no CRS tag (WGS84 geographic is implied) and no
  `AREA_OR_POINT` tag. Its geotransform puts pixel centres exactly on
  2-arc-minute nodes: lon 0 to 359 deg 58', lat +-89 deg 58' (the poles are
  excluded). The values are treated as point samples at those nodes. The
  columns span exactly 360 deg, so the grid wraps.
- Result: scale 1 nT, offset -8388608, display +-220 nT (p98 = 221.4), data
  range -3381 to +8633 nT, levelGain [1.423, 1.177, 1.066, 1.028, 1.016, 1.0].

### Gravity (EGM2008)

- Coefficients: `EGM2008.gfc` from ICGEM, the same file and sha256 that
  `pyshtools.datasets.Earth.EGM2008` uses. It is tide-free, fully normalised
  and complete to degree and order 2190.
- Quantity: free-air gravity anomaly in spherical approximation,
  `dg = -dT/dr - 2T/r`, which is ICGEM's `gravity_anomaly_sa`. It is evaluated
  on the WGS84 ellipsoid surface (h = 0). T is EGM2008 (degrees 2 to 2190)
  minus the WGS84 normal potential (even zonal terms C20 to C10,0, closed-form
  series, rescaled to EGM2008's GM and R). Degrees 0 and 1 are set to zero.
- Method: SHTOOLS `MakeGravGridDH` evaluates the radial derivative on the
  flattened ellipsoid. It is given coefficients `T_lm * (l-1)/(l+1)`, so it
  returns `-dg` with the correct `(R/r)^l` height dependence. The output grid
  is 4383 x 8764 (2.46') at geocentric latitudes. The sampler converts each
  pixel's geodetic latitude to geocentric before lookup (up to 0.19 deg
  difference). The computation takes about 50 s.
- Caveat: over high topography h = 0 lies inside the rock, so the values are
  not the classical free-air anomaly at the ground surface. The extremes are
  +991 mGal (Sierra Nevada de Santa Marta) and -392 mGal (Karakoram). Over the
  oceans and lowlands this caveat does not apply.
- Result: scale 0.1 mGal, offset -838860.8, display +-100 mGal (p98 = 103.9),
  data range -392.1 to +990.8 mGal, levelGain
  [1.276, 1.145, 1.077, 1.044, 1.031, 1.0].

## Vector and point files

- `plates.v1.geojson`: LineStrings with properties `type`, `name` and
  `plates`.
  - They are built from PB2002 *steps*, because Bird classifies each step, not
    each boundary. Consecutive steps of one boundary with the same class are
    merged. Only the original step end points are kept (0.001 deg precision,
    steps are 1 to 109 km long).
  - `type` is one of: SUB subduction zone, OSR oceanic spreading ridge, OTF
    oceanic transform fault, OCB oceanic convergent boundary, CRB continental
    rift boundary, CTF continental transform fault, CCB continental convergent
    boundary. The labels are also in `layers.json` as `typeValues`.
  - `name` is the PB2002 boundary identifier, for example `AF-AN`. `-` marks a
    non-subducting boundary. `/` means the right-hand plate subducts under the
    left-hand plate, and `\` means the opposite.
  - `plates` is `[left plate name, right plate name]`.
  - No segment crosses the antimeridian (lines are split at +-180).
- `plate-polygons.v1.geojson`: one MultiPolygon per plate, with properties
  `code` and `name` (PB2002 PlateName, for example `NA` = "North America").
  Rings use plain lon/lat, and no edge crosses the antimeridian. Plates that
  straddle it are split at +-180. The polar-cap plates AN and NA are closed
  along the pole line and the +-180 meridian. A planar even-odd ray-casting
  test in lon/lat therefore works directly. `verify` shows 3000/3000 random
  points land in exactly one plate.
- `deposits.v1.json`: columnar
  `{fields, statusValues, rows, sources}` with
  `row = [lon, lat, name, "Au;Cu", statusIndex, sourceIndex, sourceId]`.
  - Commodities are listed primary first. Metals use element symbols; REE and
    PGE are group codes.
  - MRDS rows keep the Producer, Past Producer and Prospect statuses (adding
    Occurrence would take the file well past 4 MB gzipped).
  - Duplicates at the same position with the same name are removed. MRDS
    records within 2 km of an NRCan mine with the same name are dropped.
  - Unnamed MRDS records ("Unknown") have an empty name.
- `places.v1.json`: GeoNames cities15000 with admin1 and country names, sorted
  by population (descending).

## Licences and attribution

| Output | Source | Licence | Attribution / notes |
|---|---|---|---|
| magnetic | EMAG2v3, NOAA NCEI | Public domain (US Government) | Cite Meyer, Saltus & Chulliat (2017), doi:10.7289/V5H70CVX |
| gravity | EGM2008, NGA (coefficients via ICGEM mirror) | Public domain (US Government) | Cite Pavlis et al. (2012), doi:10.1029/2011JB008916 |
| plates | PB2002, Bird (2003), GIS conversion from github.com/fraxen/tectonicplates | ODC-By 1.0 | Attribution required: Bird (2003) and the conversion repository |
| deposits | USGS MRDS | Public domain (US Government) | Legacy dataset, not updated since 2011: never imply currency |
| deposits | NRCan 900A Principal Mineral Areas, Producing Mines, and Oil and Gas Fields | Open Government Licence - Canada 2.0 | Must include the OGL-Canada attribution statement ("Contains information licensed under the Open Government Licence - Canada"). Refreshed annually by NRCan, so a re-download changes its checksum |
| places | GeoNames | CC BY 4.0 | Attribution "GeoNames" with a link to geonames.org |

The Ontario Geological Survey Mineral Deposit Inventory is not included yet.
