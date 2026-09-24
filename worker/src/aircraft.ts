// Live aircraft for the app. The free ADS-B networks do not allow cross-origin reads, so this
// Worker fetches them server-side, trims each aircraft to what the globe draws, and adds CORS.
// Sources, tried in order: adsb.lol (ODbL) and adsb.fi (free open data API). Both are community
// networks of volunteer receivers and return the same readsb format.

export const AIRCRAFT_UPSTREAMS = [
  {
    name: "adsb.lol",
    licence: "Open Database License (ODbL) 1.0",
    url: (lat: number, lon: number, r: number) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
  },
  {
    name: "adsb.fi",
    licence: "adsb.fi open data, free for non-commercial use",
    url: (lat: number, lon: number, r: number) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${r}`,
  },
];
export const AIRCRAFT_FIELDS = ["hex", "callsign", "lon", "lat", "altM", "speedKt", "track", "type", "reg"] as const;

/** Largest radius the upstream accepts, in nautical miles. */
export const MAX_RADIUS_NM = 250;

export interface AircraftFile {
  time: number;
  source: string;
  licence: string;
  fields: typeof AIRCRAFT_FIELDS;
  aircraft: (string | number | null)[][];
}

interface Upstream {
  now?: number;
  ac?: Record<string, unknown>[];
  aircraft?: Record<string, unknown>[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const round = (v: number, nd: number) => Math.round(v * 10 ** nd) / 10 ** nd;

/**
 * Round a view request so that nearby views share one cached upstream call: centre to 0.5 deg,
 * radius up to the next 50 nm. Returns null for a request that is not a valid point.
 */
export function aircraftQuery(params: URLSearchParams): { lat: number; lon: number; radius: number } | null {
  if (!params.get("lat") || !params.get("lon")) return null;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const r = Number(params.get("r") ?? 100);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const radius = Math.min(MAX_RADIUS_NM, Math.max(50, Math.ceil((Number.isFinite(r) ? r : 100) / 50) * 50));
  return { lat: Math.round(lat * 2) / 2, lon: Math.round(lon * 2) / 2, radius };
}

/** Keep aircraft with a position; altitudes become metres (0 on the ground). */
export function normaliseAircraft(
  body: Upstream,
  nowSeconds: number,
  source: { name: string; licence: string } = AIRCRAFT_UPSTREAMS[0],
): AircraftFile {
  const rows = (body.ac ?? body.aircraft ?? []).flatMap((a) => {
    const lat = num(a.lat);
    const lon = num(a.lon);
    if (lat === null || lon === null) return [];
    const feet = a.alt_baro === "ground" ? 0 : (num(a.alt_geom) ?? num(a.alt_baro));
    return [[
      str(a.hex),
      str(a.flight),
      round(lon, 4),
      round(lat, 4),
      feet === null ? null : Math.round(feet * 0.3048),
      num(a.gs),
      num(a.track),
      str(a.t),
      str(a.r),
    ]];
  });
  return {
    time: num(body.now) ?? nowSeconds,
    source: source.name,
    licence: source.licence,
    fields: AIRCRAFT_FIELDS,
    aircraft: rows,
  };
}
