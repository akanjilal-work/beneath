import { describe, expect, it } from "vitest";
import { aircraftQuery, normaliseAircraft } from "./aircraft";

describe("aircraftQuery", () => {
  it("rounds the view so nearby requests share a cache entry", () => {
    expect(aircraftQuery(new URLSearchParams("lat=43.61&lon=-79.62&r=80"))).toEqual({ lat: 43.5, lon: -79.5, radius: 100 });
    expect(aircraftQuery(new URLSearchParams("lat=43.61&lon=-79.62&r=9999"))?.radius).toBe(250);
    expect(aircraftQuery(new URLSearchParams("lat=43&lon=-79&r=1"))?.radius).toBe(50);
  });
  it("rejects a request without a valid point", () => {
    expect(aircraftQuery(new URLSearchParams("lat=95&lon=0"))).toBeNull();
    expect(aircraftQuery(new URLSearchParams("lon=0"))).toBeNull();
  });
});

describe("normaliseAircraft", () => {
  it("keeps positioned aircraft and converts feet to metres", () => {
    const file = normaliseAircraft(
      {
        now: 1790225158,
        ac: [
          { hex: "c02332", flight: "CFNIN   ", lat: 43.7, lon: -79.6, alt_baro: 4475, alt_geom: 4500, gs: 128.7, track: 321, t: "DV20", r: "C-FNIN" },
          { hex: "abc123", lat: 43.6, lon: -79.5, alt_baro: "ground", gs: 5 },
          { hex: "nopos", flight: "NOPOS", alt_baro: 30000 },
        ],
      },
      0,
    );
    expect(file.time).toBe(1790225158);
    expect(file.aircraft).toEqual([
      ["c02332", "CFNIN", -79.6, 43.7, 1372, 128.7, 321, "DV20", "C-FNIN"],
      ["abc123", null, -79.5, 43.6, 0, 5, null, null, null],
    ]);
  });
});
