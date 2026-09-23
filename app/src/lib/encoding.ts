// Value encoding shared with the pipeline (see docs/02-architecture.md):
//   raw   = R * 65536 + G * 256 + B
//   value = raw * scale + offset
//   nodata when raw == 0 (stored as NaN after decoding)

export function decodeValues(rgb: Uint8Array, scale: number, offset: number): Float32Array {
  const n = rgb.length / 3;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const raw = rgb[j] * 65536 + rgb[j + 1] * 256 + rgb[j + 2];
    out[i] = raw === 0 ? NaN : raw * scale + offset;
  }
  return out;
}

export function encodeValue(value: number, scale: number, offset: number): [number, number, number] {
  if (!Number.isFinite(value)) return [0, 0, 0];
  const raw = Math.min(0xffffff, Math.max(1, Math.round((value - offset) / scale)));
  return [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
}

/** Bilinear sample of a square tile at fractional pixel coordinates, NaN aware. */
export function sampleBilinear(values: Float32Array, size: number, px: number, py: number): number {
  // Pixel centres sit at i + 0.5.
  const fx = Math.min(size - 1, Math.max(0, px - 0.5));
  const fy = Math.min(size - 1, Math.max(0, py - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const samples = [
    [values[y0 * size + x0], (1 - tx) * (1 - ty)],
    [values[y0 * size + x1], tx * (1 - ty)],
    [values[y1 * size + x0], (1 - tx) * ty],
    [values[y1 * size + x1], tx * ty],
  ];
  let sum = 0;
  let weight = 0;
  for (const [v, w] of samples) {
    if (!Number.isNaN(v) && w > 0) {
      sum += v * w;
      weight += w;
    }
  }
  return weight > 0 ? sum / weight : NaN;
}
