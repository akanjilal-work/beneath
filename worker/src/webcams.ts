// Webcams near a point from Windy (webcams provided by windy.com). The API needs a key, which
// stays in the Worker as a secret; the app only ever sees the trimmed camera list.

export const WINDY_URL = "https://api.windy.com/webcams/api/v3/webcams";
/** Windy returns at most 50 per page; four pages cover a busy region without hammering the API. */
export const WINDY_PAGES = 4;
export const WINDY_MAX_RADIUS_KM = 250;

export interface WebcamsFile {
  source: string;
  fields: readonly string[];
  webcams: (string | number)[][];
}

export const WEBCAM_FIELDS = ["id", "lon", "lat", "title", "image", "link", "provider"] as const;

interface WindyCam {
  webcamId?: number;
  title?: string;
  status?: string;
  location?: { latitude?: number; longitude?: number };
  images?: { current?: { preview?: string } };
  urls?: { detail?: string; provider?: string };
}

/** Round a view request so nearby views share one cached answer: centre to 0.5 deg, radius to 50 km. */
export function webcamQuery(params: URLSearchParams): { lat: number; lon: number; radius: number } | null {
  if (!params.get("lat") || !params.get("lon")) return null;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const r = Number(params.get("r") ?? 100);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const radius = Math.min(WINDY_MAX_RADIUS_KM, Math.max(50, Math.ceil((Number.isFinite(r) ? r : 100) / 50) * 50));
  return { lat: Math.round(lat * 2) / 2, lon: Math.round(lon * 2) / 2, radius };
}

export function windyPageUrl(q: { lat: number; lon: number; radius: number }, page: number): string {
  const params = new URLSearchParams({
    nearby: `${q.lat},${q.lon},${q.radius}`,
    limit: "50",
    offset: String(page * 50),
    include: "location,images,urls",
  });
  return `${WINDY_URL}?${params}`;
}

/** Active cameras with a position and a preview image, de-duplicated by id. */
export function normaliseWebcams(pages: { webcams?: WindyCam[] }[]): WebcamsFile {
  const seen = new Set<number>();
  const rows: (string | number)[][] = [];
  for (const page of pages) {
    for (const c of page.webcams ?? []) {
      const lat = c.location?.latitude;
      const lon = c.location?.longitude;
      const image = c.images?.current?.preview;
      if (!c.webcamId || seen.has(c.webcamId) || c.status !== "active" || typeof lat !== "number" || typeof lon !== "number" || !image) continue;
      seen.add(c.webcamId);
      rows.push([c.webcamId, Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5, c.title ?? "Webcam", image, c.urls?.detail ?? `https://windy.com/webcams/${c.webcamId}`, c.urls?.provider ?? ""]);
    }
  }
  return { source: "Windy.com", fields: WEBCAM_FIELDS, webcams: rows };
}
