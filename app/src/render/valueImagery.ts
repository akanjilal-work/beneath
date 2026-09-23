import {
  Credit,
  Event,
  GeographicTilingScheme,
  ImageryLayer,
  Rectangle,
  WebMercatorTilingScheme,
  type TilingScheme,
  type ImageryProvider,
  type ImageryTypes,
} from "cesium";
import { getRamp, type RampId } from "../lib/ramps";
import type { ValueSource } from "./valueSource";
import { workerPool } from "./workerPool";

export interface ValueStyle {
  ramp: RampId;
  /** Relief shading on or off. */
  relief: boolean;
}

/** Apparent slope of a typical pixel step, tuned by eye on EMAG2v3 and EGM2008. */
const RELIEF_SLOPE = 0.8;

let emptyTile: HTMLCanvasElement | null = null;
function transparentTile(size: number): HTMLCanvasElement {
  if (!emptyTile || emptyTile.width !== size) {
    emptyTile = document.createElement("canvas");
    emptyTile.width = size;
    emptyTile.height = size;
  }
  return emptyTile;
}

/**
 * Cesium imagery provider for value-encoded tiles. Cesium's custom shaders do not apply
 * to imagery layers, so colour is applied here: fetch values, colourise in a worker,
 * hand Cesium an ImageBitmap. Zoom levels beyond maxzoom are overzoomed by Cesium.
 */
export class ValueImageryProvider {
  readonly tilingScheme: TilingScheme;
  readonly rectangle: Rectangle;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly minimumLevel = 0;
  readonly maximumLevel: number;
  readonly tileDiscardPolicy = undefined;
  readonly errorEvent = new Event();
  readonly credit: Credit;
  readonly proxy = undefined;
  readonly hasAlphaChannel = true;

  constructor(
    private source: ValueSource,
    private style: ValueStyle,
  ) {
    this.tilingScheme = source.geographic ? new GeographicTilingScheme() : new WebMercatorTilingScheme();
    this.rectangle = this.tilingScheme.rectangle;
    this.tileWidth = source.size;
    this.tileHeight = source.size;
    this.maximumLevel = source.entry.maxzoom;
    this.credit = new Credit(source.entry.attribution, false);
  }

  getTileCredits(): Credit[] {
    return [];
  }

  requestImage(x: number, y: number, level: number): Promise<ImageryTypes> {
    return (async () => {
      const values = await this.source.getTile(level, x, y);
      if (!values) return transparentTile(this.source.size);
      const { entry } = this.source;
      const ramp = getRamp(entry.id, this.style.ramp);
      // Colour only: coarse levels are 2x2 averages with smaller anomalies, so tighten their
      // range to match. Values themselves (and click queries) are untouched.
      const gain = entry.levelGain?.[level] ?? 1;
      const min = entry.displayMin / gain;
      const max = entry.displayMax / gain;
      // Relief: scale so a typical pixel-to-pixel step at this level gives the same slope at
      // every level, which keeps shading consistent where Cesium mixes levels.
      const step = entry.pixelStep?.[level];
      const shade = !this.style.relief ? 0 : step ? (RELIEF_SLOPE * (max - min)) / (2 * step) : 0.35 * 2 ** level;
      return workerPool().colourise(values, this.source.size, ramp.lut, min, max, shade);
    })();
  }

  pickFeatures(): undefined {
    return undefined;
  }

  asCesium(): ImageryProvider {
    return this as unknown as ImageryProvider;
  }
}

export function createValueLayer(source: ValueSource, style: ValueStyle): ImageryLayer {
  const provider = new ValueImageryProvider(source, style);
  return new ImageryLayer(provider.asCesium(), { alpha: 0, show: false });
}
