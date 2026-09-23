import { describe, expect, it } from "vitest";
import { normaliseKp } from "./kp";

const now = new Date("2026-09-22T12:00:00Z");

describe("normaliseKp", () => {
  it("reads the array-of-objects format", () => {
    const file = normaliseKp(
      [
        { time_tag: "2026-09-22T06:00:00", Kp: 2.33, a_running: 9, station_count: 8 },
        { time_tag: "2026-09-22T03:00:00", Kp: 1.667, a_running: 6, station_count: 8 },
      ],
      now,
    );
    expect(file.points).toEqual([
      { time: "2026-09-22T03:00:00Z", kp: 1.67 },
      { time: "2026-09-22T06:00:00Z", kp: 2.33 },
    ]);
    expect(file.updated).toBe(now.toISOString());
  });

  it("reads the header-plus-rows format", () => {
    const file = normaliseKp(
      [
        ["time_tag", "Kp", "a_running", "station_count"],
        ["2026-09-22 09:00:00.000", "4.00", "27", "8"],
      ],
      now,
    );
    expect(file.points).toEqual([{ time: "2026-09-22T09:00:00Z", kp: 4 }]);
  });

  it("drops bad rows and rejects unusable feeds", () => {
    const file = normaliseKp(
      [
        { time_tag: "garbage", Kp: 2 },
        { time_tag: "2026-09-22T00:00:00", Kp: 12 },
        { time_tag: "2026-09-22T03:00:00", Kp: 3 },
      ],
      now,
    );
    expect(file.points).toHaveLength(1);
    expect(() => normaliseKp({ error: "down" }, now)).toThrow();
    expect(() => normaliseKp([["time", "value"]], now)).toThrow();
    expect(() => normaliseKp([{ time_tag: "x", Kp: "y" }], now)).toThrow();
  });
});
