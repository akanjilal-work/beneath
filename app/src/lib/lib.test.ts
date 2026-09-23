import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { normaliseKp, summariseKp } from "../data/live";
import { boundaryClass } from "../data/plates";
import { parseHash, toHash } from "../state";
import { decodeValues, encodeValue, sampleBilinear } from "./encoding";
import { closestOnSegment, haversineKm, lonLatToGeoTilePixel, lonLatToTilePixel, parseLatLon, pointInPolygon } from "./geo";
import { decodePng } from "./png";

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode an RGB PNG using a mix of filters so the decoder's unfiltering is exercised. */
function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = y % 5;
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const cur = rgb[y * stride + i];
      const left = i >= 3 ? rgb[y * stride + i - 3] : 0;
      const up = y > 0 ? rgb[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= 3 ? rgb[(y - 1) * stride + i - 3] : 0;
      let pred = 0;
      if (filter === 1) pred = left;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      raw[y * (stride + 1) + 1 + i] = (cur - pred) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array()),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

describe("value encoding", () => {
  const scale = 0.1;
  const offset = -(2 ** 23) * scale;

  it("round-trips values through RGB and a real PNG", async () => {
    const values = [-812.3, -1, 0, 0.1, 57.9, 1234.5, NaN, 99999];
    const size = 4;
    const rgb = new Uint8Array(size * size * 3);
    values.forEach((val, i) => rgb.set(encodeValue(val, scale, offset), i * 3));
    const png = await decodePng(encodePng(size, size, rgb));
    expect(png.width).toBe(4);
    const decoded = decodeValues(png.rgb, scale, offset);
    values.forEach((val, i) => {
      if (Number.isNaN(val)) expect(decoded[i]).toBeNaN();
      else expect(decoded[i]).toBeCloseTo(val, 1);
    });
    // Unused pixels are raw 0, which means nodata.
    expect(decoded[15]).toBeNaN();
  });

  it("samples bilinearly and ignores nodata", () => {
    const t = new Float32Array([0, 10, 20, NaN]);
    expect(sampleBilinear(t, 2, 0.5, 0.5)).toBe(0);
    expect(sampleBilinear(t, 2, 1, 0.5)).toBeCloseTo(5);
    // Near a nodata pixel the valid neighbours are re-weighted; at its centre there is no data.
    expect(sampleBilinear(t, 2, 1.2, 1.2)).toBeCloseTo((0.21 * 10 + 0.21 * 20) / 0.51, 4);
    expect(sampleBilinear(t, 2, 1.5, 1.5)).toBeNaN();
  });
});

describe("geo", () => {
  it("finds the web mercator tile for a point", () => {
    const t = lonLatToTilePixel(0, 0, 1);
    expect([t.x, t.y]).toEqual([1, 1]);
    expect(t.px).toBeCloseTo(0);
    const g = lonLatToTilePixel(-80.25, 43.55, 6);
    expect([g.x, g.y]).toEqual([17, 23]);
    expect(lonLatToTilePixel(180, 0, 3).x).toBe(0); // wraps
  });

  it("finds the geographic tile for a point", () => {
    const a = lonLatToGeoTilePixel(-180, 90, 0);
    expect([a.x, a.y, a.px, a.py]).toEqual([0, 0, 0, 0]);
    const b = lonLatToGeoTilePixel(90, -45, 0);
    expect([b.x, b.y]).toEqual([1, 0]);
    expect(b.px).toBeCloseTo(128);
    expect(b.py).toBeCloseTo(192);
    const c = lonLatToGeoTilePixel(-80.25, 43.55, 5); // 64 x 32 tiles at z5
    expect([c.x, c.y]).toEqual([17, 8]);
    expect(lonLatToGeoTilePixel(0, -90, 2).y).toBe(3); // south pole clamps into the last row
  });

  it("measures distances", () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.19, 1);
    const [lon, lat] = closestOnSegment(0, 1, [-1, 0], [1, 0]);
    expect(lon).toBeCloseTo(0);
    expect(lat).toBeCloseTo(0);
    // Across the antimeridian.
    const [lon2] = closestOnSegment(179.9, 0, [179, 0], [-179, 0]);
    expect(Math.abs(lon2)).toBeGreaterThan(179);
  });

  it("tests points in polygons with holes", () => {
    const poly = [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ];
    expect(pointInPolygon(2, 2, poly)).toBe(true);
    expect(pointInPolygon(5, 5, poly)).toBe(false);
    expect(pointInPolygon(12, 5, poly)).toBe(false);
  });

  it("parses coordinates", () => {
    expect(parseLatLon("43.55, -80.25")).toEqual({ lat: 43.55, lon: -80.25 });
    expect(parseLatLon("-33 151")).toEqual({ lat: -33, lon: 151 });
    expect(parseLatLon("Toronto")).toBeNull();
    expect(parseLatLon("95, 10")).toBeNull();
  });
});

describe("url state", () => {
  it("round-trips through the hash", () => {
    const { state } = parseHash("#lat=43.55&lon=-80.25&alt=900000&d=2&layers=deposits,live&ramp=sequential&pick=43.55,-80.25");
    expect(state.depth).toBe(2);
    expect([...state.overlays]).toEqual(["deposits", "live"]);
    expect(state.ramp).toBe("sequential");
    expect(state.pick).toEqual({ lat: 43.55, lon: -80.25 });
    const again = parseHash(toHash(state)).state;
    expect(again).toEqual(state);
  });

  it("accepts the documented legacy layer names", () => {
    const { state, hadView } = parseHash("#layers=mag,deposits");
    expect(state.depth).toBe(1);
    expect(state.overlays.has("deposits")).toBe(true);
    expect(hadView).toBe(false);
  });

  it("clamps junk", () => {
    const { state } = parseHash("#lat=999&d=-4&ramp=rainbow&pick=a,b");
    expect(state.lat).toBe(90);
    expect(state.depth).toBe(0);
    expect(state.ramp).toBe("diverging");
    expect(state.pick).toBeNull();
  });
});

describe("live Kp", () => {
  it("reads the object and table formats", () => {
    const objects = normaliseKp([
      { time_tag: "2026-09-16T03:00:00", Kp: 3.0 },
      { time_tag: "2026-09-16T00:00:00", Kp: 3.67 },
    ]);
    expect(objects.points.map((p) => p.time)).toEqual(["2026-09-16T00:00:00Z", "2026-09-16T03:00:00Z"]);
    const table = normaliseKp([
      ["time_tag", "Kp", "a_running", "station_count"],
      ["2026-09-16 00:00:00.000", "5.33", "22", "8"],
    ]);
    expect(table.points[0]).toEqual({ time: "2026-09-16T00:00:00Z", kp: 5.33 });
    const s = summariseKp(table, Date.parse("2026-09-16T01:00:00Z"))!;
    expect(s.level).toBe("storm");
    expect(s.label).toBe("Storm (G1)");
    expect(s.stale).toBe(false);
  });
});

describe("plate boundaries", () => {
  it("classifies PB2002 codes and loose labels", () => {
    expect(boundaryClass("SUB").label).toBe("Subduction zone");
    expect(boundaryClass("subduction").key).toBe("SUB");
    expect(boundaryClass("osr").key).toBe("OSR");
    expect(boundaryClass("").key).toBe("OTHER");
  });
});
