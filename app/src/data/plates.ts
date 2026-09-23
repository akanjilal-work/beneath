import { closestOnSegment, haversineKm, pointInPolygon } from "../lib/geo";

interface LineFeature {
  type: "Feature";
  properties: { type?: string; name?: string; plates?: string[] | string };
  geometry: { type: "LineString"; coordinates: number[][] } | { type: "MultiLineString"; coordinates: number[][][] };
}

interface PolygonFeature {
  type: "Feature";
  properties: { code?: string; name?: string };
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
}

export interface FeatureCollection<F> {
  type: "FeatureCollection";
  features: F[];
}

export interface BoundaryClass {
  key: string;
  label: string;
  colour: string;
  blurb: string;
}

// Bird (2003) PB2002 step classes, plus the coarser labels some copies of the data use.
const CLASSES: Record<string, BoundaryClass> = {
  SUB: {
    key: "SUB",
    label: "Subduction zone",
    colour: "#ff6b5a",
    blurb: "One plate dives beneath another. These zones make deep trenches, volcanic arcs and the largest earthquakes.",
  },
  OSR: {
    key: "OSR",
    label: "Spreading ridge",
    colour: "#ffd166",
    blurb: "Plates pull apart and new ocean floor forms from rising magma.",
  },
  OTF: {
    key: "OTF",
    label: "Oceanic transform fault",
    colour: "#7bdff2",
    blurb: "Plates slide past each other sideways, offsetting segments of a ridge.",
  },
  CRB: {
    key: "CRB",
    label: "Continental rift",
    colour: "#ffb347",
    blurb: "A continent is being stretched and may eventually split apart.",
  },
  CTF: {
    key: "CTF",
    label: "Continental transform fault",
    colour: "#9ad0ff",
    blurb: "Plates grind past each other through continental crust, like the San Andreas Fault.",
  },
  CCB: {
    key: "CCB",
    label: "Continental collision",
    colour: "#ff8fab",
    blurb: "Continental plates push together and pile up mountain belts.",
  },
  OCB: {
    key: "OCB",
    label: "Oceanic convergent boundary",
    colour: "#f4978e",
    blurb: "Oceanic plates converge without a well-developed subduction zone.",
  },
  OTHER: {
    key: "OTHER",
    label: "Plate boundary",
    colour: "#e9e4d8",
    blurb: "A boundary between two tectonic plates, where most earthquakes and volcanoes occur.",
  },
};

export function boundaryClass(type: string | undefined): BoundaryClass {
  const t = (type ?? "").trim();
  if (!t) return CLASSES.OTHER;
  const upper = t.toUpperCase();
  if (CLASSES[upper]) return CLASSES[upper];
  if (/subduct/i.test(t)) return CLASSES.SUB;
  if (/ridge|spread/i.test(t)) return CLASSES.OSR;
  if (/transform/i.test(t)) return CLASSES.OTF;
  if (/rift/i.test(t)) return CLASSES.CRB;
  if (/collision|converg/i.test(t)) return CLASSES.CCB;
  return CLASSES.OTHER;
}

export function allBoundaryClasses(present: Set<string>): BoundaryClass[] {
  return Object.values(CLASSES).filter((c) => present.has(c.key));
}

export interface Plate {
  code: string;
  name: string;
  polygons: number[][][][];
  bbox: [number, number, number, number];
}

export interface Boundary {
  cls: BoundaryClass;
  name: string;
  lines: number[][][];
}

export class PlateModel {
  plates: Plate[];
  boundaries: Boundary[];

  constructor(boundaries: FeatureCollection<LineFeature>, polygons: FeatureCollection<PolygonFeature> | null) {
    this.boundaries = boundaries.features.map((f) => ({
      cls: boundaryClass(f.properties.type),
      name: f.properties.name ?? "",
      lines: f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates,
    }));
    this.plates = (polygons?.features ?? []).map((f) => {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const poly of polys)
        for (const [x, y] of poly[0]) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      return {
        code: f.properties.code ?? "",
        name: f.properties.name ?? f.properties.code ?? "Unnamed plate",
        polygons: polys,
        bbox: [minX, minY, maxX, maxY],
      };
    });
  }

  presentClasses(): Set<string> {
    return new Set(this.boundaries.map((b) => b.cls.key));
  }

  plateAt(lon: number, lat: number): Plate | null {
    // Polygons that cross the antimeridian may be stored with longitudes beyond ±180.
    for (const testLon of [lon, lon + 360, lon - 360]) {
      for (const p of this.plates) {
        const [minX, minY, maxX, maxY] = p.bbox;
        if (testLon < minX || testLon > maxX || lat < minY || lat > maxY) continue;
        if (p.polygons.some((poly) => pointInPolygon(testLon, lat, poly))) return p;
      }
    }
    return null;
  }

  nearestBoundary(lon: number, lat: number): { boundary: Boundary; distanceKm: number } | null {
    let best: { boundary: Boundary; distanceKm: number } | null = null;
    for (const b of this.boundaries) {
      for (const line of b.lines) {
        for (let i = 0; i < line.length - 1; i++) {
          const a = line[i];
          const c = line[i + 1];
          // Cheap reject: segments far away in latitude cannot be nearest.
          if (best) {
            const between = (a[1] - lat) * (c[1] - lat) <= 0;
            const dLat = between ? 0 : Math.min(Math.abs(a[1] - lat), Math.abs(c[1] - lat));
            if (dLat * 111 > best.distanceKm + 1) continue;
          }
          const [plon, plat] = closestOnSegment(lon, lat, a, c);
          const d = haversineKm(lat, lon, plat, plon);
          if (!best || d < best.distanceKm) best = { boundary: b, distanceKm: d };
        }
      }
    }
    return best;
  }
}
