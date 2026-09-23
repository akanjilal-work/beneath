import { PMTiles } from "pmtiles";
import { dataUrl, type RasterEntry } from "../data/manifest";
import { sampleBilinear } from "../lib/encoding";
import { lonLatToGeoTilePixel, lonLatToTilePixel } from "../lib/geo";
import { workerPool } from "./workerPool";

/** Tiles are Float32Array(256*256) = 256 KB each; 160 tiles is ~40 MB per layer. */
const CACHE_TILES = 160;

/**
 * One value-encoded raster layer: fetches tiles from a PMTiles archive, decodes them
 * in a worker, and keeps the physical values in an LRU cache for colourising and queries.
 */
export class ValueSource {
  readonly entry: RasterEntry;
  private archive: PMTiles;
  private cache = new Map<string, Float32Array | null>();
  private inflight = new Map<string, Promise<Float32Array | null>>();

  constructor(entry: RasterEntry) {
    this.entry = entry;
    this.archive = new PMTiles(dataUrl(entry.file));
  }

  get geographic(): boolean {
    return this.entry.tiling === "geographic";
  }

  get size(): number {
    return this.entry.tileSize || 256;
  }

  private remember(key: string, tile: Float32Array | null) {
    this.cache.delete(key);
    this.cache.set(key, tile);
    while (this.cache.size > CACHE_TILES) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
  }

  /** Values for a tile, or null where the archive has no tile (outside coverage). */
  getTile(z: number, x: number, y: number): Promise<Float32Array | null> {
    const key = `${z}/${x}/${y}`;
    if (this.cache.has(key)) {
      const hit = this.cache.get(key)!;
      this.remember(key, hit);
      return Promise.resolve(hit);
    }
    let p = this.inflight.get(key);
    if (!p) {
      p = (async () => {
        const res = await this.archive.getZxy(z + (this.entry.pmtilesZoomOffset ?? 0), x, y);
        const values = res ? await workerPool().decode(res.data, this.entry.scale, this.entry.offset) : null;
        this.remember(key, values);
        return values;
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  /** Physical value at a point, sampled from the highest-resolution tiles. NaN when no data. */
  async sample(lon: number, lat: number): Promise<number> {
    const t = (this.geographic ? lonLatToGeoTilePixel : lonLatToTilePixel)(lon, lat, this.entry.maxzoom, this.size);
    const tile = await this.getTile(t.z, t.x, t.y);
    return tile ? sampleBilinear(tile, this.size, t.px, t.py) : NaN;
  }
}
