// Live aircraft through the Beneath Worker (which proxies the free adsb.lol feed and adds CORS).

export interface Aircraft {
  kind: "aircraft";
  hex: string;
  callsign: string | null;
  lon: number;
  lat: number;
  /** Metres above mean sea level; 0 on the ground; null when not reported. */
  altM: number | null;
  speedKt: number | null;
  /** Degrees clockwise from true north. */
  track: number | null;
  type: string | null;
  reg: string | null;
  /** When this position was reported, ms since epoch. */
  seen: number;
}

export interface AircraftFile {
  time: number;
  source: string;
  licence: string;
  fields: string[];
  aircraft: (string | number | null)[][];
}

export function aircraftFromFile(file: AircraftFile): Aircraft[] {
  const seen = file.time * 1000;
  return file.aircraft
    .filter((r) => typeof r[0] === "string" && typeof r[2] === "number" && typeof r[3] === "number")
    .map((r) => ({
      kind: "aircraft",
      hex: r[0] as string,
      callsign: r[1] as string | null,
      lon: r[2] as number,
      lat: r[3] as number,
      altM: r[4] as number | null,
      speedKt: r[5] as number | null,
      track: r[6] as number | null,
      type: r[7] as string | null,
      reg: r[8] as string | null,
      seen,
    }));
}

/**
 * Dead reckoning: where an aircraft should be `ms` after its report, flying straight at its
 * reported ground speed and track. Keeps motion smooth between 10-second polls.
 */
export function advance(a: Aircraft, ms: number): { lon: number; lat: number } {
  if (!a.speedKt || a.track === null || !a.altM) return { lon: a.lon, lat: a.lat };
  const km = a.speedKt * 1.852 * (ms / 3_600_000);
  const t = (a.track * Math.PI) / 180;
  const dLat = (km * Math.cos(t)) / 111.2;
  const dLon = (km * Math.sin(t)) / (111.2 * Math.max(0.05, Math.cos((a.lat * Math.PI) / 180)));
  return { lat: a.lat + dLat, lon: a.lon + dLon };
}
