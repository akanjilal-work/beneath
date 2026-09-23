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

export type WorkerRequest = DecodeRequest | ColouriseRequest;

export type WorkerResponse =
  | { id: number; ok: true; values?: Float32Array; bitmap?: ImageBitmap }
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

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if (req.op === "decode") {
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
