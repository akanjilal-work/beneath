import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { normaliseKp, summariseKp } from "../data/live";
import { boundaryClass } from "../data/plates";
import { QuakeIndex, depthColour, magnitudePixels, quakesFromFeed, quakesFromFile } from "../data/quakes";
import { parseHash, toHash } from "../state";
import { decodeValues, encodeValue, sampleBilinear } from "./encoding";
import { closestOnSegment, haversineKm, lonLatToGeoTilePixel, lonLatToTilePixel, parseLatLon, pointInPolygon } from "./geo";
import { decodePng } from "./png";
import { Section } from "./section";

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

  it("round-trips see-beneath mode and a cross-section", () => {
    const { state } = parseHash("#layers=quakes&xray=1&xs=36.5,138,36.5,146&xw=200");
    expect(state.xray).toBe(true);
    expect(state.section).toEqual({ a: { lat: 36.5, lon: 138 }, b: { lat: 36.5, lon: 146 }, w: 200 });
    expect(parseHash(toHash(state)).state).toEqual(state);
    // Old links without these keys are unchanged, and a malformed section is ignored.
    expect(parseHash("#lat=1&lon=2").state.section).toBeNull();
    expect(parseHash("#xs=95,0,0,0").state.section).toBeNull();
    expect(parseHash("#xs=1,2,3").state.section).toBeNull();
    expect(parseHash("#xs=1,2,3,4&xw=150").state.section?.w).toBe(100);
    expect(parseHash("#xs=1,2,3,4&xw=9999").state.section?.w).toBe(300);
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

describe("cross-section geometry", () => {
  it("measures length and samples the great circle", () => {
    // Along the equator, 10 degrees is about 1,112 km.
    const s = new Section({ lat: 0, lon: 0 }, { lat: 0, lon: 10 });
    expect(s.lengthKm).toBeCloseTo(1111.95, 0);
    const mid = s.at(0.5);
    expect(mid.lat).toBeCloseTo(0, 9);
    expect(mid.lon).toBeCloseTo(5, 9);
    expect(s.sample(3).map((p) => Math.round(p.lon))).toEqual([0, 5, 10]);
  });
  it("projects points to along-track and signed cross-track distance", () => {
    const s = new Section({ lat: 0, lon: 0 }, { lat: 0, lon: 10 });
    const north = s.project(1, 5);
    expect(north.alongKm).toBeCloseTo(555.97, 0);
    expect(north.offsetKm).toBeCloseTo(111.19, 0); // left of an eastward line is north
    expect(s.project(-1, 5).offsetKm).toBeCloseTo(-111.19, 0);
    expect(s.project(0, -2).alongKm).toBeLessThan(0);
  });
  it("works across the antimeridian", () => {
    const s = new Section({ lat: -20, lon: 175 }, { lat: -20, lon: -175 });
    expect(s.lengthKm).toBeGreaterThan(1040);
    expect(s.lengthKm).toBeLessThan(1050);
    const p = s.project(-20.1, 180);
    expect(p.alongKm).toBeGreaterThan(500);
    expect(p.alongKm).toBeLessThan(550);
    expect(Math.abs(p.offsetKm)).toBeLessThan(15);
  });
  it("finds where another line crosses the section", () => {
    const s = new Section({ lat: 0, lon: 0 }, { lat: 0, lon: 10 });
    expect(s.crossing({ lat: -1, lon: 3 }, { lat: 1, lon: 3 })).toBeCloseTo(333.6, 0);
    expect(s.crossing({ lat: 1, lon: 3 }, { lat: 2, lon: 3 })).toBeNull(); // does not reach the line
    expect(s.crossing({ lat: -1, lon: 12 }, { lat: 1, lon: 12 })).toBeNull(); // beyond B
  });
});

describe("earthquakes", () => {
  const file = {
    stride: 5,
    fields: ["lon", "lat", "depthKm", "mag", "days"],
    count: 3,
    data: [142.37, 38.3, 29, 9.1, 15044, 179.9, -20, 600, 6.2, 15000, -179.9, -20.2, 550, 5.5, 15001],
    names: { "0": "2011 Great Tohoku Earthquake, Japan" },
  };
  const quakes = quakesFromFile(file);
  it("unpacks the flat catalogue", () => {
    expect(quakes[0]).toMatchObject({ lon: 142.37, lat: 38.3, depthKm: 29, mag: 9.1, name: "2011 Great Tohoku Earthquake, Japan" });
    expect(new Date(quakes[0].time).toISOString().slice(0, 10)).toBe("2011-03-11");
    expect(quakes[1].name).toBeNull();
  });
  it("finds events near a point, across the antimeridian", () => {
    const index = new QuakeIndex(quakesFromFile(file));
    const s = index.summarise(180, -20.1, 100);
    expect(s.count).toBe(2);
    expect(s.deepest?.depthKm).toBe(600);
    expect(index.summarise(0, 0, 100).count).toBe(0);
    // A huge radius near a pole must not count an event twice.
    expect(index.near(0, 89, 9000).length).toBe(new Set(index.near(0, 89, 9000)).size);
  });
  it("selects events in a cross-section swath", () => {
    const index = new QuakeIndex(quakesFromFile(file));
    const hits = index.inSwath(new Section({ lat: -20, lon: 178 }, { lat: -20, lon: -178 }), 50);
    expect(hits.map((h) => h.quake.depthKm).sort()).toEqual([550, 600]);
  });
  it("merges the live feed without duplicating catalogue events", () => {
    const index = new QuakeIndex(quakesFromFile(file));
    const feed = {
      features: [
        { id: "dup", properties: { mag: 9.1, time: quakes[0].time + 3_600_000, place: "Japan", type: "earthquake" }, geometry: { coordinates: [142.37, 38.3, 29] as [number, number, number] } },
        { id: "new", properties: { mag: 4.1, time: Date.UTC(2026, 8, 20), place: "Chile", type: "earthquake" }, geometry: { coordinates: [-71, -30, 40] as [number, number, number] } },
        { id: "blast", properties: { mag: 3, time: Date.UTC(2026, 8, 20), place: "Mine", type: "quarry blast" }, geometry: { coordinates: [-71, -30, 0] as [number, number, number] } },
      ],
    };
    const added = index.addRecent(quakesFromFeed(feed, 0));
    expect(added.map((q) => q.name)).toEqual(["Chile"]);
    expect(index.quakes.length).toBe(4);
    expect(added[0].index).toBe(3);
  });
  it("colours by depth and sizes by magnitude", () => {
    expect(depthColour(0)).toBe("rgb(255,69,58)");
    expect(depthColour(700)).toBe("rgb(191,90,242)");
    expect(magnitudePixels(9)).toBeGreaterThan(magnitudePixels(6));
    expect(magnitudePixels(5)).toBeGreaterThanOrEqual(2);
  });
});
