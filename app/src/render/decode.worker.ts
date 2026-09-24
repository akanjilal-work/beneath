/// <reference lib="webworker" />
// Decodes value tiles and colourises them off the main thread.

import { decodeValues } from "../lib/encoding";
import { decodePng } from "../lib/png";

export interface DecodeRequest {
  op: "decode";
  id: number;
  bytes: ArrayBuffer;
  scale: number;
  offset: number;
}

export interface ColouriseRequest {
  op: "colourise";
  id: number;
  values: Float32Array;
  size: number;
  lut: Uint8ClampedArray;
  min: number;
  max: number;
  /** Relief shading strength, 0 disables. Already scaled for zoom by the caller. */
  shade: number;
}

/** Fetch a Terrarium elevation tile and resample it to a size x size heightmap. */
export interface TerrainRequest {
  op: "terrain";
  id: number;
  url: string;
  size: number;
  /** Keep heights below sea level (for profiles); the 3D globe holds oceans at sea level. */
  seaFloor?: boolean;
}

export type WorkerRequest = DecodeRequest | ColouriseRequest | TerrainRequest;

export type WorkerResponse =
  | { id: number; ok: true; values?: Float32Array | null; bitmap?: ImageBitmap }
  | { id: number; ok: false; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

const RAMP_EXPONENT = 0.75;

// Light from the north-west, 45 degrees up.
const LX = -0.5;
const LY = -0.5;
const LZ = Math.SQRT1_2;

function colourise(req: ColouriseRequest): ImageData {
  const { values, size, lut, min, max, shade } = req;
  const out = new Uint8ClampedArray(size * size * 4);
  const span = max - min || 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = values[i];
      const o = i * 4;
      if (Number.isNaN(v)) continue; // transparent
      // Ramps are symmetric about the centre of the display range. A gentle power curve
      // (exponent below 1) spreads weak anomalies away from the neutral colour; the ends
      // and the centre still map exactly, which is all the legend labels.
      const u = Math.min(1, Math.max(-1, ((v - min) / span) * 2 - 1));
      const curved = Math.sign(u) * Math.abs(u) ** RAMP_EXPONENT;
      const t = Math.round((curved + 1) * 127.5);
      let f = 1;
      if (shade > 0) {
        const l = values[y * size + Math.max(0, x - 1)];
        const r = values[y * size + Math.min(size - 1, x + 1)];
        const u = values[Math.max(0, y - 1) * size + x];
        const d = values[Math.min(size - 1, y + 1) * size + x];
        const dx = Number.isNaN(l) || Number.isNaN(r) ? 0 : ((r - l) / span) * shade;
        const dy = Number.isNaN(u) || Number.isNaN(d) ? 0 : ((d - u) / span) * shade;
        // Surface normal (-dx, -dy, 1); y grows southwards in pixel space.
        const lambert = (-dx * LX - dy * LY + LZ) / Math.sqrt(dx * dx + dy * dy + 1);
        // Flat ground stays at full colour; slopes lighten or darken by at most about a third.
        f = Math.min(1.15, Math.max(0.62, 1 + 0.5 * (lambert - LZ)));
      }
      out[o] = lut[t * 4] * f;
      out[o + 1] = lut[t * 4 + 1] * f;
      out[o + 2] = lut[t * 4 + 2] * f;
      out[o + 3] = 255;
    }
  }
  return new ImageData(out, size, size);
}

/**
 * Terrarium encoding: metres = R * 256 + G + B / 256 - 32768. The heightmap posts span the tile
 * edge to edge (Cesium shares edge posts between neighbours), so post i sits at fraction i/(size-1)
 * across the tile and is bilinearly sampled from the 256 px pixel centres.
 */
async function terrain(req: TerrainRequest): Promise<Float32Array | null> {
  const res = await fetch(req.url);
  if (!res.ok) return null;
  const png = await decodePng(new Uint8Array(await res.arrayBuffer()));
  const w = png.width;
  const src = new Float32Array(w * png.height);
  for (let i = 0, j = 0; i < src.length; i++, j += 3) {
    src[i] = png.rgb[j] * 256 + png.rgb[j + 1] + png.rgb[j + 2] / 256 - 32768;
  }
  const n = req.size;
  const out = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    const fy = Math.min(png.height - 1, Math.max(0, (r / (n - 1)) * png.height - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(png.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let c = 0; c < n; c++) {
      const fx = Math.min(w - 1, Math.max(0, (c / (n - 1)) * w - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      const h =
        (src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx) * (1 - ty) +
        (src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx) * ty;
      // The source includes bathymetry. Sea floor under an imagery-coloured sea looks wrong,
      // so oceans are held at sea level (this also flattens the few land areas below it).
      out[r * n + c] = req.seaFloor ? h : Math.max(0, h);
    }
  }
  return out;
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if (req.op === "terrain") {
      const values = await terrain(req);
      const res: WorkerResponse = { id: req.id, ok: true, values };
      scope.postMessage(res, values ? [values.buffer] : []);
    } else if (req.op === "decode") {
      const png = await decodePng(new Uint8Array(req.bytes));
      const values = decodeValues(png.rgb, req.scale, req.offset);
      const res: WorkerResponse = { id: req.id, ok: true, values };
      scope.postMessage(res, [values.buffer]);
    } else {
      // Cesium's own imagery loader decodes bitmaps with imageOrientation "flipY", and its
      // texture upload relies on that (WebGL's UNPACK_FLIP_Y does not apply to ImageBitmap).
      // Unflipped bitmaps render each tile upside down.
      const bitmap = await createImageBitmap(colourise(req), { imageOrientation: "flipY" });
      const res: WorkerResponse = { id: req.id, ok: true, bitmap };
      scope.postMessage(res, [bitmap]);
    }
  } catch (err) {
    const res: WorkerResponse = { id: req.id, ok: false, error: String(err) };
    scope.postMessage(res);
  }
};
