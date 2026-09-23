import { Credit, CustomHeightmapTerrainProvider, EllipsoidTerrainProvider, WebMercatorTilingScheme, type TerrainProvider } from "cesium";
import { TERRAIN_MAX_LEVEL, TERRAIN_URL } from "../config";
import { workerPool } from "./workerPool";

/** Posts per heightmap tile edge. 65 is Cesium's usual heightmap size. */
const POSTS = 65;

export const TERRAIN_CREDIT =
  'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles on AWS</a> (SRTM, GMTED2010, ETOPO1, 3DEP, Copernicus DEM and <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">others</a>)';

/**
 * 3D terrain from Terrarium elevation tiles, decoded and resampled in the worker pool. Tiles use
 * the same Web Mercator XYZ scheme as the source, so tile (x, y, level) maps to one PNG.
 * Past the source's deepest level Cesium keeps refining geometry from the parent tile.
 */
export function createTerrainProvider(): TerrainProvider {
  if (TERRAIN_URL === "off") return new EllipsoidTerrainProvider();
  const provider = new CustomHeightmapTerrainProvider({
    tilingScheme: new WebMercatorTilingScheme(),
    width: POSTS,
    height: POSTS,
    credit: new Credit(TERRAIN_CREDIT, false),
    callback: (x: number, y: number, level: number) => {
      if (level > TERRAIN_MAX_LEVEL) return undefined;
      const url = TERRAIN_URL.replace("{z}", String(level)).replace("{x}", String(x)).replace("{y}", String(y));
      // A failed or missing tile yields a flat one rather than an error, so the globe never has holes.
      return workerPool()
        .terrain(url, POSTS)
        .then((h) => h ?? new Float32Array(POSTS * POSTS))
        .catch(() => new Float32Array(POSTS * POSTS));
    },
  });
  return provider;
}
