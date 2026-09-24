// Active satellites from a daily CelesTrak snapshot of two-line elements. Positions are computed
// in the browser with SGP4 (satellite.js), so they move live between snapshots.

import { eciToEcf, eciToGeodetic, gstime, propagate, twoline2satrec, type SatRec } from "satellite.js";

export interface SatellitesFile {
  updated: string;
  source: string;
  sourceUrl: string;
  sats: [string, string, string][];
}

export type OrbitClass = "station" | "starlink" | "leo" | "meo" | "geo" | "heo";

export const ORBIT_CLASSES: { id: OrbitClass; label: string; colour: string }[] = [
  { id: "station", label: "Crewed stations", colour: "#ffffff" },
  { id: "starlink", label: "Starlink", colour: "#6f8fb8" },
  { id: "leo", label: "Low orbit", colour: "#4fd1e8" },
  { id: "meo", label: "Medium orbit (GPS)", colour: "#a3e635" },
  { id: "geo", label: "Geostationary", colour: "#ffd166" },
  { id: "heo", label: "Highly elliptical", colour: "#f472b6" },
];

export interface Satellite {
  kind: "satellite";
  index: number;
  name: string;
  noradId: string;
  satrec: SatRec;
  cls: OrbitClass;
  periodMin: number;
  inclinationDeg: number;
  eccentricity: number;
  /** Mean altitude from the semi-major axis, km. */
  meanAltKm: number;
}

const MU = 398600.4418; // km^3 / s^2
const EARTH_RADIUS_KM = 6378.137;
const STATIONS = /^(ISS \(ZARYA\)|CSS \(TIANHE\)|TIANGONG|ISS)/;

export function classify(name: string, periodMin: number, ecc: number, meanAltKm: number): OrbitClass {
  if (STATIONS.test(name)) return "station";
  if (ecc > 0.25) return "heo";
  if (name.startsWith("STARLINK")) return "starlink";
  if (meanAltKm < 2000) return "leo";
  if (periodMin > 1380 && periodMin < 1500 && ecc < 0.05) return "geo";
  return "meo";
}

export function satellitesFromFile(file: SatellitesFile): Satellite[] {
  const out: Satellite[] = [];
  for (const [name, l1, l2] of file.sats) {
    const satrec = twoline2satrec(l1, l2);
    if (satrec.error || !(satrec.no > 0)) continue;
    const periodMin = (2 * Math.PI) / satrec.no; // no is radians per minute
    const n = satrec.no / 60; // radians per second
    const a = Math.cbrt(MU / (n * n));
    const meanAltKm = a - EARTH_RADIUS_KM;
    out.push({
      kind: "satellite",
      index: out.length,
      name,
      noradId: String(satrec.satnum).trim(),
      satrec,
      cls: classify(name, periodMin, satrec.ecco, meanAltKm),
      periodMin,
      inclinationDeg: (satrec.inclo * 180) / Math.PI,
      eccentricity: satrec.ecco,
      meanAltKm,
    });
  }
  return out;
}

export interface SatPosition {
  /** Earth-fixed position, km. */
  ecf: { x: number; y: number; z: number };
  lat: number;
  lon: number;
  altKm: number;
  speedKmS: number;
}

/** Where a satellite is at a moment, or null when SGP4 cannot place it (decayed elements). */
export function positionAt(sat: Satellite, date: Date, gmst = gstime(date)): SatPosition | null {
  const pv = propagate(sat.satrec, date);
  if (!pv || typeof pv.position !== "object" || !pv.position || typeof pv.velocity !== "object" || !pv.velocity) return null;
  const { x, y, z } = pv.position;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const geo = eciToGeodetic(pv.position, gmst);
  const v = pv.velocity;
  return {
    ecf: eciToEcf(pv.position, gmst),
    lat: (geo.latitude * 180) / Math.PI,
    lon: (geo.longitude * 180) / Math.PI,
    altKm: geo.height,
    speedKmS: Math.hypot(v.x, v.y, v.z),
  };
}

/**
 * One full orbit in the Earth-fixed frame of the given moment, for drawing the orbit as a loop
 * (the planet's rotation during the orbit is left out so the loop closes).
 */
export function orbitPath(sat: Satellite, date: Date, steps = 180): { x: number; y: number; z: number }[] {
  const gmst = gstime(date);
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = new Date(date.getTime() + (i / steps) * sat.periodMin * 60_000);
    const pv = propagate(sat.satrec, t);
    if (pv && typeof pv.position === "object" && pv.position) out.push(eciToEcf(pv.position, gmst));
  }
  return out;
}
