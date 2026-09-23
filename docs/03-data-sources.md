# 03. Data sources and licences

Every layer must pass a licence check before it ships. Record the result here and in the layer's entry in `layers.json` (which the app shows in the legend and the About dialog).

## Shipped in v1

| Layer | Source | Resolution / type | Licence | Attribution shown |
|---|---|---|---|---|
| Magnetic anomaly | EMAG2v3, NOAA NCEI (upward-continued grid, 4 km above geoid) | Global grid, 2 arc-minute | Public domain (US Government) | "EMAG2v3, NOAA NCEI", citation Meyer, Saltus & Chulliat (2017), doi:10.7289/V5H70CVX |
| Gravity anomaly | EGM2008, NGA: free-air anomaly synthesised from the spherical-harmonic coefficients to degree 2190 | Global grid, about 5 arc-minute effective (about 18 km wavelength) | Public domain (US Government) | "EGM2008, NGA" |
| Plate boundaries and plates | PB2002, Bird (2003), GeoJSON conversion from github.com/fraxen/tectonicplates | Lines (per-step boundary class) and 52 plate polygons | ODC-By 1.0 | "Bird (2003) PB2002; GIS conversion by Nordpil (github.com/fraxen/tectonicplates)". ODC-By requires this attribution. |
| Deposits (global) | USGS Mineral Resources Data System (MRDS) | 200,659 points: producers, past producers, prospects | Public domain (US Government) | "USGS MRDS". Labelled **legacy, not updated since 2011** on every card entry. |
| Deposits (Canada) | Natural Resources Canada, Principal Mineral Areas, Producing Mines, and Oil and Gas Fields (map 900A) | 175 producing mines | Open Government Licence – Canada 2.0 | Required statement shown: "Contains information licensed under the Open Government Licence – Canada." |
| Gazetteer | GeoNames `cities15000` with country and admin1 names | 34,146 places | CC BY 4.0 | "GeoNames" |
| Coastlines | Natural Earth 1:50m | Lines | Public domain | "Natural Earth" |
| Base imagery | Natural Earth II, shipped with CesiumJS | Raster tiles, self-hosted | Public domain | "Natural Earth II" |
| Satellite imagery | Sentinel-2 cloudless 2024, EOX IT Services (tiles.maps.eox.at) | 10 m, Web Mercator to level 15 | CC BY-NC-SA 4.0 (non-commercial) | "Sentinel-2 cloudless 2024 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024)" in the credits bar. For any commercial use switch `VITE_IMAGERY_URL` to the CC BY 4.0 2016 edition or a licensed provider. |
| Terrain | Terrain Tiles on AWS (Terrarium) | About 30 m globally, finer where lidar exists | Mixed open sources, attribution required | "Terrain Tiles on AWS (SRTM, GMTED2010, ETOPO1, 3DEP, Copernicus DEM and others)" with a link to the full attribution list |
| Live Kp index | NOAA Space Weather Prediction Center, planetary K-index JSON | 3-hourly | Public domain (US Government) | "NOAA SWPC" |

Sources, checksums and download dates are in `pipeline/sources/manifest.json`.

## Decisions

- **Gravity: EGM2008 instead of WGM2012.** WGM2012 (Bureau Gravimétrique International) had the least clear redistribution terms for derived tiles. EGM2008 is a US Government product with no such restriction. It has less short-wavelength detail than WGM2012 on land, and its free-air values are evaluated on the ellipsoid, so over high mountains they are not the anomaly at the ground surface. The About dialog and the card copy describe the values as free-air.
- **Deposits: Ontario Mineral Deposit Inventory deferred.** Canada ships with NRCan's producing mines only. The Ontario inventory (Open Government Licence – Ontario) is the richest local source and is the next deposit layer to add.
- **Deposits: occurrences left out.** MRDS occurrences would push the deposit file past its 4 MB (gzipped) budget. Producers, past producers and prospects ship.

## Not yet shipped

| Layer | Source | Licence status | Notes |
|---|---|---|---|
| Deposits (Ontario) | Ontario Geological Survey, Mineral Deposit Inventory | Open Government Licence – Ontario expected; to verify | Planned. |
| Paleo reconstructions | GPlates Web Service | To verify | Pre-bake at 10 Myr steps; do not call live from the browser. |
| Observatory data | INTERMAGNET | To verify display terms | Optional, v2. The Worker polls Kp only. |

## Rules

- Keep original source files, checksums and download dates in `pipeline/sources/manifest.json`
- Show attribution for every visible layer in the legend
- Never imply currency for legacy datasets
- If a licence is unclear, the layer does not ship until it is resolved
