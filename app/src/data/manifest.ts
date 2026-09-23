import { DATA_BASE_URL } from "../config";

interface BaseEntry {
  id: string;
  name?: string;
  file: string;
  attribution: string;
  licence: string;
  sourceUrl?: string;
  citation?: string;
}

export interface RasterEntry extends BaseEntry {
  kind: "raster-value";
  units: string;
  scale: number;
  offset: number;
  minzoom: number;
  maxzoom: number;
  tileSize: number;
  displayMin: number;
  displayMax: number;
  dataMin?: number;
  dataMax?: number;
  /** Colour contrast gain per zoom level (coarser levels are averaged, so they lose amplitude). */
  levelGain?: number[];
  /** Mean |difference| between adjacent pixels per level, used to normalise relief shading. */
  pixelStep?: number[];
  /**
   * "geographic": EPSG:4326, 2^(z+1) x 2^z tiles per level, matching Cesium's GeographicTilingScheme.
   * "webmercator" (default): standard XYZ slippy tiles.
   */
  tiling?: "geographic" | "webmercator";
  /** Geographic level z is stored in the PMTiles archive at zoom z + this offset. */
  pmtilesZoomOffset?: number;
}

export interface VectorEntry extends BaseEntry {
  kind: "vector";
  polygons?: string;
}

export interface PointsEntry extends BaseEntry {
  kind: "points";
}

export interface GazetteerEntry extends BaseEntry {
  kind: "gazetteer";
}

export type LayerEntry = RasterEntry | VectorEntry | PointsEntry | GazetteerEntry;

export interface Manifest {
  version: number;
  generated: string;
  layers: LayerEntry[];
}

export function dataUrl(file: string): string {
  return new URL(file, DATA_BASE_URL).toString();
}

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(dataUrl("layers.json"), { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load layers.json (${res.status})`);
  return (await res.json()) as Manifest;
}

export function findLayer<K extends LayerEntry["kind"]>(
  manifest: Manifest,
  id: string,
  kind: K,
): Extract<LayerEntry, { kind: K }> | undefined {
  return manifest.layers.find((l) => l.id === id && l.kind === kind) as
    | Extract<LayerEntry, { kind: K }>
    | undefined;
}

export async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(dataUrl(file));
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
  return (await res.json()) as T;
}
