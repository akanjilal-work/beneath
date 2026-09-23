// Small geodesy helpers. Accuracy targets a visual click card, not surveying.

export const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Wrap a longitude difference into [-180, 180). */
export function wrapLon(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/** Web Mercator tile containing a point, plus the fractional pixel position inside it. */
export function lonLatToTilePixel(lon: number, lat: number, z: number, tileSize = 256) {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const xf = ((wrapLon(lon) + 180) / 360) * n;
  const latRad = clampedLat * RAD;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.floor(xf));
  const y = Math.min(n - 1, Math.max(0, Math.floor(yf)));
  return { x, y, z, px: (xf - x) * tileSize, py: (yf - y) * tileSize };
}

/**
 * Geographic (EPSG:4326) tile containing a point: level z has 2^(z+1) columns from -180 and
 * 2^z rows from +90, as in Cesium's GeographicTilingScheme.
 */
export function lonLatToGeoTilePixel(lon: number, lat: number, z: number, tileSize = 256) {
  const cols = 2 ** (z + 1);
  const rows = 2 ** z;
  const xf = ((wrapLon(lon) + 180) / 360) * cols;
  const yf = ((90 - Math.max(-90, Math.min(90, lat))) / 180) * rows;
  const x = Math.min(cols - 1, Math.floor(xf));
  const y = Math.min(rows - 1, Math.floor(yf));
  return { x, y, z, px: (xf - x) * tileSize, py: (yf - y) * tileSize };
}

/** Ray casting point-in-ring test in lon/lat space. */
export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(lon: number, lat: number, polygon: number[][][]): boolean {
  if (!pointInRing(lon, lat, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) {
    if (pointInRing(lon, lat, polygon[h])) return false;
  }
  return true;
}

/**
 * Closest point on segment AB to P, working in a local equirectangular frame centred on P.
 * Returns the closest point in lon/lat so the caller can measure a true great-circle distance.
 */
export function closestOnSegment(
  lon: number,
  lat: number,
  a: number[],
  b: number[],
): [number, number] {
  const k = Math.cos(lat * RAD);
  const ax = wrapLon(a[0] - lon) * k;
  const ay = a[1] - lat;
  const bx = wrapLon(b[0] - lon) * k;
  const by = b[1] - lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return [lon + (k === 0 ? 0 : cx / k), lat + cy];
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}

/** Parse "43.55, -80.25" or "43.55 -80.25". */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function foldAscii(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
