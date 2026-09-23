import { foldAscii, haversineKm } from "../lib/geo";

export interface PlacesFile {
  fields: string[];
  rows: [string, string, string, number, number, number][];
}

export interface Place {
  name: string;
  admin1: string;
  country: string;
  lat: number;
  lon: number;
  pop: number;
  folded: string;
}

export function placeLabel(p: Place): string {
  return [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : "", p.country].filter(Boolean).join(", ");
}

/** Bundled gazetteer: search by name and reverse lookup, no external API. */
export class Gazetteer {
  places: Place[];
  private buckets = new Map<number, Place[]>();

  constructor(file: PlacesFile) {
    this.places = file.rows
      .map(([name, admin1, country, lat, lon, pop]) => ({
        name,
        admin1,
        country,
        lat,
        lon,
        pop,
        folded: foldAscii(name),
      }))
      .sort((a, b) => b.pop - a.pop);
    for (const p of this.places) {
      const key = this.key(Math.floor(p.lon / 5), Math.floor(p.lat / 5));
      let list = this.buckets.get(key);
      if (!list) this.buckets.set(key, (list = []));
      list.push(p);
    }
  }

  private key(ix: number, iy: number): number {
    return (((ix % 72) + 72) % 72) * 100 + (iy + 18);
  }

  search(query: string, limit = 8): Place[] {
    const q = foldAscii(query.trim());
    if (q.length < 2) return [];
    const prefix: Place[] = [];
    const contains: Place[] = [];
    for (const p of this.places) {
      if (p.folded.startsWith(q)) {
        prefix.push(p);
        if (prefix.length >= limit) break;
      } else if (contains.length < limit && p.folded.includes(q)) {
        contains.push(p);
      }
    }
    return [...prefix, ...contains].slice(0, limit);
  }

  /** Nearest populated place within ~1,500 km, weighted slightly toward larger places. */
  nearest(lat: number, lon: number): { place: Place; distanceKm: number } | null {
    let best = null as { place: Place; distanceKm: number; score: number } | null;
    const ix0 = Math.floor(lon / 5);
    const iy0 = Math.floor(lat / 5);
    for (let ring = 0; ring <= 3; ring++) {
      for (let iy = iy0 - ring; iy <= iy0 + ring; iy++) {
        if (iy < -18 || iy > 17) continue;
        for (let ix = ix0 - ring; ix <= ix0 + ring; ix++) {
          if (Math.max(Math.abs(ix - ix0), Math.abs(iy - iy0)) !== ring) continue;
          for (const p of this.buckets.get(this.key(ix, iy)) ?? []) {
            const d = haversineKm(lat, lon, p.lat, p.lon);
            const score = d / (1 + Math.log10(Math.max(10, p.pop)) / 6);
            if (!best || score < best.score) best = { place: p, distanceKm: d, score };
          }
        }
      }
      // A match in the inner rings is always closer than anything two rings out.
      if (best && best.distanceKm < ring * 400) break;
    }
    return best && best.distanceKm < 1500 ? { place: best.place, distanceKm: best.distanceKm } : null;
  }
}
