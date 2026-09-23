// Colour ramps, interpolated in OKLab so equal steps in value look like equal steps in colour.

export type RampId = "diverging" | "sequential";

export interface Ramp {
  id: string;
  /** 256 entries, RGBA bytes. */
  lut: Uint8ClampedArray;
  /** CSS gradient for legends. */
  css: string;
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toLinear = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

function rgbToOklab([r, g, b]: Rgb): Rgb {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function buildRamp(id: string, stops: string[]): Ramp {
  const labs = stops.map((s) => rgbToOklab(hexToRgb(s)));
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (labs.length - 1);
    const k = Math.min(labs.length - 2, Math.floor(t));
    const f = t - k;
    const a = labs[k];
    const b = labs[k + 1];
    const rgb = oklabToRgb([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    lut.set([...rgb, 255], i * 4);
  }
  const css = `linear-gradient(to right, ${stops.join(", ")})`;
  return { id, lut, css };
}

// Magnetic: blue (negative) to red (positive). Gravity: teal to purple, a different hue pair
// so the two layers are never confused when cross-fading.
const RAMP_STOPS: Record<string, Record<RampId, string[]>> = {
  magnetic: {
    diverging: ["#0d2a6b", "#2f6db5", "#8fbbe0", "#f2f0eb", "#eea47f", "#c4452f", "#6b0d12"],
    sequential: ["#0d0887", "#5b02a3", "#9a179b", "#cb4678", "#eb7852", "#fbb32f", "#f0f921"],
  },
  gravity: {
    diverging: ["#003c38", "#1c7c70", "#86c5b5", "#f2f0eb", "#c6a3d8", "#83489e", "#3b0a52"],
    sequential: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725", "#fdf5b0"],
  },
};

const cache = new Map<string, Ramp>();

export function getRamp(layerId: string, ramp: RampId): Ramp {
  const key = `${layerId}:${ramp}`;
  let r = cache.get(key);
  if (!r) {
    const stops = (RAMP_STOPS[layerId] ?? RAMP_STOPS.magnetic)[ramp];
    r = buildRamp(key, stops);
    cache.set(key, r);
  }
  return r;
}
