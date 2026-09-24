# 05. Build plan

Estimates assume part-time solo work.

## Phase 0. Groundwork (about 1 week)

- [x] Create repo `beneath` under github.com/akanjilal-work
- [x] Resolve licences for magnetic, gravity and Ontario deposits (see 03) (gravity switched to EGM2008; Ontario inventory deferred)
- [ ] Set up Cloudflare account, R2 bucket and public custom domain for tiles (deferred: tiles ship on GitHub Pages, see 06)
- [x] Pipeline skeleton: fetch and checksum EMAG2v3
- [x] Value-encode EMAG2v3 and produce a PMTiles pyramid (geographic, levels 0 to 5)
- [x] Prove decoding: a throwaway HTML page that fetches one tile and prints values (done as `pipeline verify` plus the app's click card)

**Done when:** a correct magnetic value can be read in the browser for a known coordinate.

## Phase 1. MVP (2 to 3 weeks)

- [x] Vite + TypeScript + CesiumJS app, no ion dependency
- [x] Custom ImageryProvider with Web Worker decode, LRU cache and colour ramp
- [x] Magnetic and gravity layers
- [x] Ontario and Canada deposit points (Canada: NRCan producing mines; Ontario inventory still to add)
- [x] Plate boundaries
- [x] Depth slider (stops 1 to 4)
- [x] Click card with templated text
- [x] Search with bundled gazetteer
- [x] URL state for sharing
- [x] Legend and attribution
- [x] GitHub Actions deploy to Pages
- [x] Open Graph image and metadata

**Done when:** the v1 success criteria in 01 are met and the site is public.

## Phase 2. Live layer (about 1 week)

- [x] Cloudflare Worker with 15-minute cron (code, tests and CI deploy ready; deploys when `CLOUDFLARE_API_TOKEN` is set)
- [x] Kp index JSON written to R2 (observatory data pending licence check)
- [x] "Survey conditions today" badge and live overlay
- [x] Graceful fallback when feeds are stale

**Done when:** the badge reflects current Kp within 20 minutes of NOAA publishing.

## Phase 3. Deep time (about 2 weeks)

- [ ] Pre-bake reconstructed coastlines and plates at 10 Myr steps
- [ ] Time slider revealed at depth stop 5
- [ ] Reconstruct deposit positions with their host plates
- [ ] Smooth interpolation between steps

## Phase 4. Polish (1 to 2 weeks)

- [x] Mobile bottom-sheet layout
- [ ] Performance pass against the budgets in 02
- [ ] Accessibility pass (see 04)
- [x] Global legacy deposits (USGS MRDS) with clear labelling
- [ ] Launch posts (Show HN, Reddit geology and dataisbeautiful communities)

## Phase 5. Beneath the surface

- [x] Earthquake catalogue in the pipeline (USGS ComCat, M5+ since 1970, one request per year, checksummed)
- [x] Earthquakes drawn on the globe, coloured by depth and sized by magnitude
- [x] See-beneath mode: translucent surface with every earthquake at its true depth
- [x] Live earthquakes from the USGS 7-day feed, merged without duplicates
- [x] Cross-section tool: elevation with sea floor, magnetic, gravity, plate boundaries crossed, earthquakes by depth, shareable in the URL
- [ ] Guided stories: fly-throughs of well-known features with a short card each
- [ ] More public-domain layers (volcanoes, sea-floor age) where a source needs no licence terms

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Gravity data licence blocks redistribution | Lose a core layer | Identify fallback model in Phase 0 |
| Cesium bundle too heavy on mobile | Slow first load | Lazy-load Cesium workers, measure early |
| Deposit data inconsistent across sources | Confusing UI | Normalise to one schema, launch Canada first |
| Live feed endpoint changes | Broken live layer | Worker validates schema, UI shows stale state |
| Polar cutoff in Web Mercator | Missing data above about 85 degrees | Resolved: rasters use geographic tiles with full polar coverage |
