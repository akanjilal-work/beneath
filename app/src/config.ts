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
export const IMAGERY_CREDIT: string =
  env.VITE_IMAGERY_CREDIT ||
  'Sentinel-2 cloudless 2024 by <a href="https://s2maps.eu" target="_blank" rel="noopener">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2024), <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>';
