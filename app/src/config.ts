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
