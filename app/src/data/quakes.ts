// Earthquakes: the M5+ catalogue since 1970 (built by the pipeline) plus the USGS live feed
// for the past week. Both are held in the same flat shape so drawing and queries treat them alike.

import { haversineKm } from "../lib/geo";
import type { Section } from "../lib/section";

export interface QuakesFile {
  stride: number;
  fields: string[];
  count: number;
  data: number[];
  names: Record<string, string>;
}

export interface Quake {
  index: number;
  lon: number;
  lat: number;
  depthKm: number;
  mag: number;
  /** Event time in milliseconds since the Unix epoch (UTC). Catalogue events are day precision. */
  time: number;
  name: string | null;
  recent: boolean;
}

const DAY_MS = 86_400_000;

export function quakesFromFile(file: QuakesFile): Quake[] {
  const { stride, data, names } = file;
  const out: Quake[] = new Array(file.count);
  for (let i = 0; i < file.count; i++) {
    const o = i * stride;
    out[i] = {
      index: i,
      lon: data[o],
      lat: data[o + 1],
      depthKm: data[o + 2],
      mag: data[o + 3],
      time: data[o + 4] * DAY_MS,
      name: names[String(i)] ?? null,
      recent: false,
    };
  }
  return out;
}

/** USGS GeoJSON summary feed (https://earthquake.usgs.gov/earthquakes/feed/). */
export interface UsgsFeed {
  features: {
    id: string;
    properties: { mag: number | null; time: number; place: string | null; type: string };
    geometry: { coordinates: [number, number, number] };
  }[];
}

export const LIVE_QUAKES_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";

export function quakesFromFeed(feed: UsgsFeed, firstIndex: number): Quake[] {
  return feed.features
    .filter((f) => f.properties.type === "earthquake" && f.properties.mag !== null)
    .map((f, i) => ({
      index: firstIndex + i,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depthKm: Math.max(0, f.geometry.coordinates[2] ?? 0),
      mag: f.properties.mag!,
      time: f.properties.time,
      name: f.properties.place,
      recent: true,
    }));
}

/** Colour by depth, the convention seismologists use: shallow warm, intermediate green, deep violet. */
export const DEPTH_STOPS: [number, string][] = [
  [0, "#ff453a"],
  [35, "#ff9f0a"],
  [70, "#ffd60a"],
  [150, "#32d74b"],
  [300, "#0a84ff"],
  [500, "#5e5ce6"],
  [700, "#bf5af2"],
];

function hex(c: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
}

/** CSS colour for a hypocentre depth, interpolated between the stops. */
export function depthColour(depthKm: number): string {
  const d = Math.max(0, Math.min(700, depthKm));
  for (let i = 1; i < DEPTH_STOPS.length; i++) {
    const [d1, c1] = DEPTH_STOPS[i];
    if (d <= d1) {
      const [d0, c0] = DEPTH_STOPS[i - 1];
      const f = (d - d0) / (d1 - d0);
      const a = hex(c0);
      const b = hex(c1);
      return `rgb(${a.map((v, k) => Math.round(v + f * (b[k] - v))).join(",")})`;
    }
  }
  return DEPTH_STOPS[DEPTH_STOPS.length - 1][1];
}

/** CSS gradient matching depthColour over 0 to 700 km, for the legend. */
export const DEPTH_GRADIENT = `linear-gradient(to right, ${DEPTH_STOPS.map(([d, c]) => `${c} ${(d / 700) * 100}%`).join(", ")})`;

/** Screen size in pixels: energy grows about 32 times per magnitude step, so size grows steeply. */
export function magnitudePixels(mag: number): number {
  return Math.max(2, 1.6 * 1.55 ** (mag - 4.2));
}

export function formatDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function describeQuake(q: Quake): string {
  const when = q.recent ? new Date(q.time).toISOString().slice(0, 16).replace("T", " ") + " UTC" : formatDate(q.time);
  return `M${q.mag.toFixed(1)} · ${when} · ${Math.round(q.depthKm)} km deep`;
}

export interface NearbySummary {
  count: number;
  largest: Quake | null;
  deepest: Quake | null;
  recent: number;
}

/** Catalogue queries. Coarse 2-degree cells keep radius and swath lookups fast on 90k events. */
export class QuakeIndex {
  quakes: Quake[];
  /** Events from the live feed that were not already in the catalogue. */
  recentCount = 0;
  private cells = new Map<string, Quake[]>();

  constructor(catalogue: Quake[]) {
    this.quakes = catalogue;
    for (const q of catalogue) this.addToCell(q);
  }

  private addToCell(q: Quake) {
    const key = `${Math.floor(q.lon / 2)},${Math.floor(q.lat / 2)}`;
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = []));
    cell.push(q);
  }

  /** Append the live feed, dropping any event the catalogue already has (same place and minute). */
  addRecent(recent: Quake[]) {
    const fresh = recent.filter(
      (r) => !this.near(r.lon, r.lat, 5).some((q) => !q.recent && Math.abs(q.time - r.time) < DAY_MS && Math.abs(q.mag - r.mag) < 0.3),
    );
    this.recentCount += fresh.length;
    for (const q of fresh) {
      q.index = this.quakes.length;
      this.quakes.push(q);
      this.addToCell(q);
    }
    return fresh;
  }

  near(lon: number, lat: number, radiusKm: number): Quake[] {
    const dLat = radiusKm / 111;
    const dLon = radiusKm / (111 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
    const out: Quake[] = [];
    let x0 = Math.floor((lon - dLon) / 2);
    let x1 = Math.floor((lon + dLon) / 2);
    // Wider than the whole globe (large radius near a pole): visit every column exactly once.
    if (x1 - x0 + 1 >= 180) [x0, x1] = [-90, 89];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = Math.floor((lat - dLat) / 2); cy <= Math.floor((lat + dLat) / 2); cy++) {
        const wrapped = ((((cx * 2 + 180) % 360) + 360) % 360) / 2 - 90;
        for (const q of this.cells.get(`${wrapped},${cy}`) ?? []) {
          if (haversineKm(lat, lon, q.lat, q.lon) <= radiusKm) out.push(q);
        }
      }
    }
    return out;
  }

  summarise(lon: number, lat: number, radiusKm: number): NearbySummary {
    const list = this.near(lon, lat, radiusKm);
    let largest: Quake | null = null;
    let deepest: Quake | null = null;
    let recent = 0;
    for (const q of list) {
      if (q.recent) recent++;
      if (!largest || q.mag > largest.mag) largest = q;
      if (!deepest || q.depthKm > deepest.depthKm) deepest = q;
    }
    return { count: list.length, largest, deepest, recent };
  }

  /** Events within halfWidthKm of a cross-section line, with their position along it. */
  inSwath(section: Section, halfWidthKm: number): { quake: Quake; alongKm: number; offsetKm: number }[] {
    const out: { quake: Quake; alongKm: number; offsetKm: number }[] = [];
    // A cheap bounding test first: great-circle distance from the midpoint.
    const mid = section.at(0.5);
    const reach = section.lengthKm / 2 + halfWidthKm + 50;
    for (const q of reach > 5000 ? this.quakes : this.near(mid.lon, mid.lat, reach)) {
      const p = section.project(q.lat, q.lon);
      if (Math.abs(p.offsetKm) <= halfWidthKm && p.alongKm >= 0 && p.alongKm <= section.lengthKm) {
        out.push({ quake: q, alongKm: p.alongKm, offsetKm: p.offsetKm });
      }
    }
    return out;
  }
}
