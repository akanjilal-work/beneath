# app

Vite + TypeScript + CesiumJS frontend, deployed to GitHub Pages. No Cesium ion token and no application server: everything runs in the browser against static files.

## Commands

```bash
npm ci
npm run dev      # http://localhost:5173, serves ../pipeline/out at /data/ (with Range support)
npm test         # unit tests: PNG decoder, value encoding, tile math, URL state, Kp parser
npm run build    # type-check + production build into dist/
```

`npm run dev` needs the pipeline outputs in `pipeline/out/` (see `pipeline/README.md`), or download a data release into `pipeline/out/`:

```bash
gh release download data-v1 --repo akanjilal-work/beneath --dir ../pipeline/out
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `VITE_DATA_BASE_URL` | `./data/` (same origin) | Where `layers.json`, PMTiles and JSON live. Set to the R2 custom domain to serve tiles from Cloudflare. |
| `VITE_LIVE_KP_URL` | NOAA SWPC K-index JSON | Live Kp source. Set to the Worker's `/live/kp.json` once deployed. |

In CI these come from repository variables of the same name.

## Source map

| Path | What it does |
|---|---|
| `src/main.ts` | Boot, wiring between state, globe and UI |
| `src/state.ts` | Single store serialised to the URL hash |
| `src/render/globe.ts` | Cesium viewer (no ion), vector overlays, picking, auto-rotate |
| `src/render/valueImagery.ts` | Custom `ImageryProvider`: value tiles to colour |
| `src/render/valueSource.ts` | PMTiles access, LRU cache of decoded `Float32Array` tiles, point sampling |
| `src/render/decode.worker.ts` | Web Worker: PNG decode, value decode, colourise, relief shading |
| `src/lib/png.ts` | Exact PNG decoder (avoids canvas colour management altering values) |
| `src/lib/ramps.ts` | OKLab-interpolated colour ramps |
| `src/data/*` | Manifest, plates, deposits, gazetteer, live Kp |
| `src/ui/*` | Layer panel, depth slider, legend, click card, search, Kp badge |
