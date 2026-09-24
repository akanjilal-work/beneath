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

describe("aircraft sources", () => {
  it("builds each network's point query and labels the file with the source used", async () => {
    const { AIRCRAFT_UPSTREAMS } = await import("./aircraft");
    expect(AIRCRAFT_UPSTREAMS.map((u) => u.url(43.5, -79.5, 100))).toEqual([
      "https://api.adsb.lol/v2/point/43.5/-79.5/100",
      "https://opendata.adsb.fi/api/v2/lat/43.5/lon/-79.5/dist/100",
    ]);
    const file = normaliseAircraft({ aircraft: [{ hex: "a", lat: 1, lon: 2 }] }, 5, AIRCRAFT_UPSTREAMS[1]);
    expect(file.source).toBe("adsb.fi");
    expect(file.aircraft.length).toBe(1);
  });
});

describe("OpenSky overview", () => {
  it("converts state vectors: metres to metres, m/s to knots, ground to 0", async () => {
    const { normaliseOpenSky } = await import("./aircraft");
    const file = normaliseOpenSky(
      {
        time: 1_790_000_000,
        states: [
          ["c07e33", "ACA101  ", "Canada", 0, 0, -79.62811, 43.68801, 10668, false, 231.5, 91.4, 0, null, 10972.8, "1000", false, 0],
          ["c01234", "WJA22   ", "Canada", 0, 0, -79.6, 43.6, null, true, 5, 180, 0, null, null, null, false, 0],
          ["nopos", "X", "Canada", 0, 0, null, null, 1000, false, 100, 0, 0, null, 1000, null, false, 0],
        ],
      },
      0,
    );
    expect(file.time).toBe(1_790_000_000);
    expect(file.aircraft).toEqual([
      ["c07e33", "ACA101", -79.628, 43.688, 10973, 450, 91, null, null],
      ["c01234", "WJA22", -79.6, 43.6, 0, 10, 180, null, null],
    ]);
  });
});
