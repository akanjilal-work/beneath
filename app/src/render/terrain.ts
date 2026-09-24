import { Credit, CustomHeightmapTerrainProvider, EllipsoidTerrainProvider, GeographicTilingScheme, Math as CesiumMath, type TerrainProvider } from "cesium";
import { TERRAIN_MAX_LEVEL, TERRAIN_URL } from "../config";
import { workerPool } from "./workerPool";

/** Posts per heightmap tile edge. 65 is Cesium's usual heightmap size. */
const POSTS = 65;

export const TERRAIN_CREDIT =
  'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles on AWS</a> (SRTM, GMTED2010, ETOPO1, 3DEP, Copernicus DEM and <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">others</a>)';

/**
 * 3D terrain from Terrarium elevation tiles, decoded and resampled in the worker pool. The globe
 * uses geographic (lat/lon) tiles so it has no holes at the poles, where the Web Mercator source
 * stops at 85 degrees; each geographic tile samples the Mercator tiles one level finer, which
 * spans the same longitude. Past the source's deepest level Cesium keeps refining from the parent.
 */
export function createTerrainProvider(): TerrainProvider {
  if (TERRAIN_URL === "off") return new EllipsoidTerrainProvider();
  const tilingScheme = new GeographicTilingScheme();
  const flat = () => new Float32Array(POSTS * POSTS);
  const provider = new CustomHeightmapTerrainProvider({
    tilingScheme,
    width: POSTS,
    height: POSTS,
    credit: new Credit(TERRAIN_CREDIT, false),
    callback: (x: number, y: number, level: number) => {
      if (level + 1 > TERRAIN_MAX_LEVEL) return undefined;
      const r = tilingScheme.tileXYToRectangle(x, y, level);
      const deg = CesiumMath.toDegrees;
      // A failed or missing tile yields a flat one rather than an error, so the globe never has holes.
      return workerPool()
        .terrainGeo(TERRAIN_URL, level + 1, [deg(r.west), deg(r.south), deg(r.east), deg(r.north)], POSTS)
        .catch(flat);
    },
  });
  return provider;
}
