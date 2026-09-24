# 02. Architecture

## Principle

All heavy work happens offline in the data pipeline. At runtime the site is static files plus WebGL in the browser. No application server.

## System diagram

```
[Public datasets]
      |
      v
Python pipeline (GDAL, rasterio, pmtiles)      runs locally, on data refresh
      |
      v
PMTiles + JSON, served next to the app   <----  Cloudflare Worker (optional, cron every 15 min)
(GitHub Pages today; R2 later, one variable)      writes live/kp.json
      | HTTP range requests
      v
Static app on GitHub Pages (Vite + CesiumJS)
      |
      v
User's browser: decode tiles, colourise, render globe, answer click queries
```

## Components

### Frontend (`app/`)

- **Build:** Vite, TypeScript
- **Globe:** CesiumJS, used without Cesium ion. Base imagery is self-hosted (for example NASA Blue Marble tiles) so no ion token is required.
- **Tiling scheme:** geographic (EPSG:4326), matching Cesium's `GeographicTilingScheme`: level z has 2^(z+1) × 2^z tiles of 256 px. The plan started with Web Mercator, but Mercator tiles shrink towards the poles, so Cesium drew finer levels at high latitudes than at the equator in the same view and the data showed hard contrast bands. Geographic tiles fix that and cover the poles. In the PMTiles archive, geographic level z is stored at zoom z + 1 (`pmtilesZoomOffset` in `layers.json`), because PMTiles tile IDs assume square levels.
- **State:** a single small store serialised to and from the URL hash.
- **Terrain:** 3D elevation from the public Terrain Tiles on AWS (Terrarium PNG, Web Mercator, levels 0 to 15; about 30 m in most places, a few metres where lidar exists). Tiles are fetched and decoded in the same Web Worker pool and handed to Cesium's `CustomHeightmapTerrainProvider` as 65 × 65 heightmaps. Oceans are held at sea level because the source includes bathymetry.
- **Imagery:** Sentinel-2 cloudless 2024 (EOX, 10 m) over the bundled Natural Earth II, which stays underneath as an instant fallback. Both sources are configurable (`VITE_IMAGERY_URL`, `VITE_TERRAIN_URL`).
- **Earthquakes:** a `PointPrimitiveCollection` of about 92,000 hypocentres, coloured by depth and sized by magnitude. In see-beneath mode the globe's translucency is switched on and each point moves to its depth below the ellipsoid, so the surface no longer hides it.
- **Cross-sections:** great-circle geometry on unit vectors (`lib/section.ts`), so lines work across the antimeridian and near the poles. The profile reads elevation straight from the Terrarium tiles with the sea floor kept (the 3D globe holds oceans at sea level), samples the magnetic and gravity tiles already used for the click card, and projects earthquakes within the chosen swath onto the line. Nothing is computed on a server.
- **Live layers above the surface:** satellites are drawn from a daily snapshot of CelesTrak two-line elements (`app/scripts/snapshot-live.mjs`, run by the deploy workflow) and propagated in the browser with SGP4 (`satellite.js`), a slice at a time so frames never stall. Camera lists come from the same daily snapshot; each camera image loads straight from its agency. Aircraft need a live feed that browsers cannot read directly, so the Worker proxies adsb.lol at `/aircraft` with a few seconds of Cloudflare caching; the app polls it every 10 seconds for the area in view and moves each aircraft along its track between polls.
- **Surface view:** a drone-style camera that holds a set height above the terrain. Cesium's globe controls are switched off while it is active; dragging turns the view, keys or the on-screen pad move along the ground. Terrain depth testing is on only in this mode, so sea-level overlays do not show through hills. Deposits in view are lifted onto the sampled terrain height when the camera is low.

### Value-encoded raster tiles

Tiles store the physical value, not a colour. This enables client-side colour ramps and exact point queries without a backend.

Encoding per pixel (24-bit, lossless PNG):

```
raw   = R * 65536 + G * 256 + B
value = raw * scale + offset
nodata when raw == 0
```

A single `layers.json` manifest describes every layer: `scale`, `offset`, `units`, `displayMin`/`displayMax`, `dataMin`/`dataMax`, `tiling`, `levelGain`, `attribution`, `licence` and `citation`. The same entry is embedded in each PMTiles file's metadata.

Coarser levels are NaN-aware 2×2 means of the level above (a true pyramid, not point samples), so they do not alias. Averaging shrinks anomalies, so each raster carries a `levelGain` per level (the 98th-percentile ratio to the finest level) that the app uses to tighten the colour range on coarse tiles. It affects colour only; click queries always read the finest level. Each raster also carries `pixelStep` per level (the mean difference between adjacent pixels), which the app uses to normalise relief shading so slopes look the same at every level.

Tiles reach Cesium as `ImageBitmap`s decoded with `imageOrientation: "flipY"`, matching Cesium's own imagery loader: WebGL's `UNPACK_FLIP_Y` does not apply to bitmaps, and unflipped bitmaps render each tile upside down.

**Rendering approach.** CesiumJS custom shaders do not apply to imagery layers, so decoding happens in a custom `ImageryProvider`:

1. Fetch the value tile from PMTiles
2. Decode the PNG with a small exact decoder (browser canvas decoding may colour-manage pixels and corrupt values), then to a `Float32Array`, kept in an LRU cache
3. Colourise with the active OKLab ramp, plus optional relief shading from the value gradient
4. Return an `ImageBitmap` to Cesium as the tile image

Changing the colour ramp re-colourises cached tiles without re-fetching. Click queries read directly from the cached `Float32Array`. Decoding and colourising run in a Web Worker to keep the main thread free.

### Resolution budget

EMAG2v3 is a 2 arc-minute grid (about 3.7 km at the equator). A 256 px geographic tile at level 5 covers 5.625° across 256 px, about 1.3 arc-minutes per pixel, so **levels 0 to 5** capture the source resolution. That is 2,730 tiles per layer. Beyond level 5 Cesium overzooms rather than fetching more tiles.

### Vector data

- Small enough to ship as compact JSON, so no vector tiling was needed: plate boundaries and polygons (GeoJSON), coastlines (GeoJSON), deposits (columnar JSON, 3.7 MB gzipped, about 200k points)
- Deposits carry: name, commodities, status (prospect, past producer, producer), source, source ID
- Deposits are drawn as Cesium point primitives. Producers show from far away, and past producers, prospects and industrial minerals appear as you zoom in

### Click card

Assembled entirely in the browser from:

- Layer values at the point (from cached tiles)
- Nearest deposits within a radius
- Plate name and nearest boundary type
- A text template per value range ("strong positive magnetic anomaly, often associated with...")

Optional v2: send the assembled facts to a Worker endpoint for LLM narration. The facts, not the model, stay the source of truth.

### Live feed (`worker/`)

- The NOAA SWPC K-index feed allows cross-origin reads, so by default the app polls it directly every 5 minutes while the live layer is on
- Optional Cloudflare Worker with a cron trigger every 15 minutes: validates and normalises the feed, writes `live/kp.json` to R2 and serves it with CORS. Point the app at it with `VITE_LIVE_KP_URL`
- A bad poll keeps the last good file; the app marks data older than 9 hours as stale

### Data pipeline (`pipeline/`)

```
fetch (checksummed) -> build source grid -> resample to level 5 pixel centres (bilinear)
      -> 2x2-mean pyramid to level 0 -> value-encode -> PMTiles -> layers.json -> verify
```

- Python 3.11+, rasterio (bundled GDAL), numpy, pyshtools (gravity synthesis), Pillow, pmtiles
- Each dataset has a small config (source URL, checksum, units, scale, offset, licence)
- Outputs are reproducible: same inputs give byte-identical PMTiles

## Performance budget

| Item | Budget |
|---|---|
| Initial JS (gzipped, excluding Cesium workers) | under 1.5 MB |
| Time to interactive globe | under 4 s on mid-range laptop |
| Tile decode and colourise | under 10 ms per tile in worker |
| Click card | under 300 ms |

## Security and privacy

- No cookies, no accounts, no personal data collected
- Privacy-respecting analytics only (for example Cloudflare Web Analytics or Plausible)
- R2 bucket is public read-only for tiles. Worker writes use a scoped binding, never keys in the repo.
- Dependabot and CodeQL enabled on the repo
