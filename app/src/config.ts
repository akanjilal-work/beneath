// Where data lives. By default the tiles are deployed next to the app (./data/).
// Point VITE_DATA_BASE_URL at an R2 custom domain (for example https://data.beneath.example/)
// to serve them from Cloudflare instead; no other change is needed.
function withSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

const env = import.meta.env;

export const DATA_BASE_URL = new URL(
  withSlash(env.VITE_DATA_BASE_URL || "./data/"),
  document.baseURI,
).toString();

// Live geomagnetic feed. If a Worker writes normalised JSON to R2, set VITE_LIVE_KP_URL to it.
// Otherwise the app reads NOAA SWPC directly (the feed allows cross-origin requests).
export const LIVE_KP_URL: string =
  env.VITE_LIVE_KP_URL || "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";

export const LIVE_POLL_MS = 5 * 60 * 1000;

// Daily snapshots of slow-changing live sources (satellite orbits, camera lists), written next
// to the app by the deploy workflow (scripts/snapshot-live.mjs).
export const LIVE_SNAPSHOT_URL = new URL("./data/live/", document.baseURI).toString();

// The Beneath Worker, which proxies feeds that browsers cannot read directly (live aircraft).
// Leave unset and the aircraft layer is shown as unavailable.
export const LIVE_PROXY_URL: string = env.VITE_LIVE_PROXY_URL || "";

// Elevation for 3D terrain: Terrarium-encoded PNG tiles (Web Mercator XYZ). The default is the
// public AWS Terrain Tiles dataset, which allows cross-origin reads. Set VITE_TERRAIN_URL to "off"
// to fall back to a smooth globe.
export const TERRAIN_URL: string =
  env.VITE_TERRAIN_URL || "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRAIN_MAX_LEVEL = 15;

// Close-range satellite imagery (Web Mercator XYZ, {z}/{y}/{x}). EOX Sentinel-2 cloudless 2024:
// 10 m, CC BY-NC-SA 4.0, fine for this non-commercial educational site. For commercial use swap
// in the CC BY 4.0 2016 edition ("s2cloudless_3857") or a keyed provider via VITE_IMAGERY_URL.
export const IMAGERY_URL: string =
  env.VITE_IMAGERY_URL || "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
export const IMAGERY_MAX_LEVEL = 15;

// Sharper imagery over the United States: USGS The National Map orthoimagery (NAIP and
// high-resolution orthos, public domain), about 1 m per pixel. The service has no tiles
// outside the US, so it is only requested inside these boxes (west, south, east, north).
// Sharp imagery worldwide for regional and close-up views: Esri World Imagery (Maxar and others,
// about 0.3 to 1 m), through an ArcGIS Location Platform key. The key is public by design (it is
// restricted to this site's address in the ArcGIS dashboard). Without it, close-ups fall back to
// Sentinel-2 plus the USGS imagery over the US below.
export const HIRES_IMAGERY_KEY: string = env.VITE_IMAGERY_KEY || "";
export const HIRES_IMAGERY_URL = "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const HIRES_IMAGERY_MAX_LEVEL = 19;
export const HIRES_IMAGERY_CREDIT =
  'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> · Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export const US_IMAGERY_URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";
export const US_IMAGERY_MAX_LEVEL = 18;
export const US_IMAGERY_BOXES: [number, number, number, number][] = [
  [-125, 24.4, -66.8, 49.5], // contiguous states
  [-170, 51, -129.9, 71.5], // Alaska
  [-160.6, 18.8, -154.7, 22.3], // Hawaii
  [-67.4, 17.8, -65.2, 18.6], // Puerto Rico
];
export const US_IMAGERY_CREDIT = "USGS The National Map: Orthoimagery (public domain)";
export const IMAGERY_CREDIT: string =
  env.VITE_IMAGERY_CREDIT ||
  'Sentinel-2 cloudless 2024 by <a href="https://s2maps.eu" target="_blank" rel="noopener">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2024), <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>';
