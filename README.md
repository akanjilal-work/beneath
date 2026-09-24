# Beneath

An explorable 3D globe of what lies under the Earth's surface: earthquakes at their true depth, cross-sections through the crust and mantle, magnetic anomalies, gravity, mineral deposits, tectonic plates and live geomagnetic conditions.

Think Earth Nullschool, but for the subsurface.

**Live:** https://beneath.akanjilal.dev/

## What you can do

- Drag the **depth slider** from Surface to Magnetic, Gravity and Plates. Adjacent layers cross-fade.
- Turn on **See beneath** (<kbd>X</kbd>) to make the surface translucent. Every M5+ earthquake since 1970 then sits at the depth where it started, so sinking plates show as sheets of earthquakes diving into the mantle. Earthquakes from the past 7 days come from the live USGS feed and carry a white ring.
- Draw a **cross-section** (<kbd>C</kbd>, or **Section from here** on any card): click two points and get the elevation and sea-floor profile, the magnetic and gravity readings, the plate boundaries crossed, and every earthquake near the line plotted by depth.
- **Click or tap** anywhere for a plain-language card: magnetic (nT) and gravity (mGal) values at that point, the plate, the nearest boundary and its type, earthquakes within 100 km, and deposits within 50 km. Click an earthquake for its magnitude, date and depth.
- **Go to the surface** from any card, or **Visit site** on a deposit, to fly down onto 3D terrain with satellite imagery, arriving at an angle like a map's 3D view. Over the US the close-up imagery is about 1 m per pixel (USGS, public domain), elsewhere 10 m (Sentinel-2). Drag to look around, move with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> (or the on-screen pad), rise and descend with <kbd>E</kbd>/<kbd>Q</kbd>. The depth slider still drapes the data layers over the land.
- Turn on the **live layers above the surface**: about 16,000 **satellites** moving in real time (click one for its orbit), live **aircraft** near the view, and public **traffic cameras** in California and New York State with their latest image.
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
