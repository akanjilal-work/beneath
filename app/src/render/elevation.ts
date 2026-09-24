import { TERRAIN_URL } from "../config";
import { lonLatToTilePixel } from "../lib/geo";
import { workerPool } from "./workerPool";

/** Posts per tile edge for profiles: about half the source's 256 px, plenty for a 200-point line. */
const POSTS = 129;
const CACHE_TILES = 160;
const cache = new Map<string, Promise<Float32Array | null>>();

function tile(level: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${level}/${x}/${y}`;
  let p = cache.get(key);
  if (!p) {
    const url = TERRAIN_URL.replace("{z}", String(level)).replace("{x}", String(x)).replace("{y}", String(y));
    p = workerPool().terrain(url, POSTS, true).catch(() => null);
    cache.set(key, p);
    while (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

/**
 * Ground height in metres at each point, sea floor included, read straight from the Terrarium
 * tiles. The 3D globe holds oceans at sea level, but a cross-section should show the trenches.
 */
export async function elevationProfile(points: { lat: number; lon: number }[], level: number): Promise<number[]> {
  if (TERRAIN_URL === "off") return points.map(() => NaN);
  return Promise.all(
    points.map(async (p) => {
      const t = lonLatToTilePixel(p.lon, p.lat, level, 256);
      const v = await tile(level, t.x, t.y);
      if (!v) return NaN;
      // Posts span the tile edge to edge, so pixel position px maps to post px / 256 * (POSTS - 1).
      const fx = (t.px / 256) * (POSTS - 1);
      const fy = (t.py / 256) * (POSTS - 1);
      const x0 = Math.min(POSTS - 2, Math.floor(fx));
      const y0 = Math.min(POSTS - 2, Math.floor(fy));
      const tx = fx - x0;
      const ty = fy - y0;
      const at = (x: number, y: number) => v[y * POSTS + x];
      return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    }),
  );
}
