# Beneath

An explorable 3D globe of what lies under the Earth's surface: magnetic anomalies, gravity, mineral deposits, tectonic plates and live geomagnetic conditions.

Think Earth Nullschool, but for the subsurface.

**Live:** https://akanjilal-work.github.io/beneath/

## What you can do

- Drag the **depth slider** from Surface to Magnetic, Gravity and Plates. Adjacent layers cross-fade.
- **Click or tap** anywhere for a plain-language card: magnetic (nT) and gravity (mGal) values at that point, the plate, the nearest boundary and its type, and deposits within 50 km.
- **Search** a place or type `lat, lon`.
- **Share** any view: the whole state lives in the URL.
- Check **survey conditions today** from the live planetary K-index.

Educational only. Not an exploration or investment tool.

## How it works

All heavy work happens offline in the Python pipeline. At runtime the site is static files plus WebGL. Raster tiles store physical values (24-bit, lossless PNG in PMTiles), so the browser colourises them and answers point queries itself, with no backend. See [docs/02-architecture.md](docs/02-architecture.md).

## Repository layout

| Folder | Purpose | Runs on |
|---|---|---|
| [`app/`](app/) | Vite + TypeScript + CesiumJS frontend | GitHub Pages |
| [`pipeline/`](pipeline/) | Python data pipeline: fetch, reproject, value-encode, package PMTiles | Local machine |
| [`worker/`](worker/) | Cloudflare Worker that polls live geomagnetic feeds (optional) | Cloudflare Workers (cron) |
| [`docs/`](docs/) | Build plan, architecture, design, data sources | n/a |

## Quick start

```bash
# Data: build it (see pipeline/README.md) or fetch the published release
gh release download data-v1 --repo akanjilal-work/beneath --dir pipeline/out

# App
cd app && npm ci && npm run dev    # http://localhost:5173
```

## Documents

1. [Overview and scope](docs/01-overview.md)
2. [Architecture](docs/02-architecture.md)
3. [Data sources and licences](docs/03-data-sources.md)
4. [UI and interaction design](docs/04-design.md)
5. [Build plan](docs/05-build-plan.md)
6. [Hosting and deployment](docs/06-hosting-and-deploy.md)

## Licence

Application code: [MIT](LICENSE). Each data layer keeps its own licence and attribution, listed in [docs/03-data-sources.md](docs/03-data-sources.md) and shown in the app's legend.
