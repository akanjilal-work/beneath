// Great-circle geometry for cross-sections: sample a line between two points, and measure how
// far along it (and how far to the side of it) any other point lies. Unit vectors keep this
// exact across the antimeridian and near the poles, where lon/lat arithmetic breaks down.

import { EARTH_RADIUS_KM } from "./geo";

export interface LatLon {
  lat: number;
  lon: number;
}

type Vec = [number, number, number];
const RAD = Math.PI / 180;

export function toVec(lat: number, lon: number): Vec {
  const la = lat * RAD;
  const lo = lon * RAD;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

export function toLatLon(v: Vec): LatLon {
  const r = Math.hypot(v[0], v[1], v[2]);
  return { lat: Math.asin(v[2] / r) / RAD, lon: Math.atan2(v[1], v[0]) / RAD };
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec): Vec => {
  const r = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / r, a[1] / r, a[2] / r];
};

/** A great-circle segment from A to B, with helpers for projecting points onto it. */
export class Section {
  readonly a: Vec;
  readonly b: Vec;
  /** Unit normal of the great-circle plane; points with positive dot lie to the left of A to B. */
  readonly n: Vec;
  /** Unit vector at A pointing along the line towards B. */
  private readonly t: Vec;
  /** Central angle between A and B, in radians. */
  readonly angle: number;
  readonly lengthKm: number;

  constructor(a: LatLon, b: LatLon) {
    this.a = toVec(a.lat, a.lon);
    this.b = toVec(b.lat, b.lon);
    this.angle = Math.acos(Math.max(-1, Math.min(1, dot(this.a, this.b))));
    this.lengthKm = this.angle * EARTH_RADIUS_KM;
    // A and B nearly coincident or antipodal: fall back to an east-west line through A.
    const c = cross(this.a, this.b);
    this.n = Math.hypot(...c) > 1e-9 ? norm(c) : norm(cross(this.a, [0, 0, 1]));
    this.t = cross(this.n, this.a);
  }

  /** Point at a fraction f (0 at A, 1 at B) along the great circle. */
  at(f: number): LatLon {
    const th = f * this.angle;
    const v: Vec = [0, 1, 2].map((i) => Math.cos(th) * this.a[i] + Math.sin(th) * this.t[i]) as Vec;
    return toLatLon(v);
  }

  /** Evenly spaced points from A to B, inclusive. */
  sample(count: number): LatLon[] {
    return Array.from({ length: count }, (_, i) => this.at(count === 1 ? 0 : i / (count - 1)));
  }

  /**
   * Where a point sits relative to the line: distance along it from A (km, may fall outside
   * 0..length) and signed perpendicular distance (km, positive to the left).
   */
  project(lat: number, lon: number): { alongKm: number; offsetKm: number } {
    const p = toVec(lat, lon);
    const off = Math.asin(Math.max(-1, Math.min(1, dot(p, this.n))));
    const along = Math.atan2(dot(p, this.t), dot(p, this.a));
    return { alongKm: along * EARTH_RADIUS_KM, offsetKm: off * EARTH_RADIUS_KM };
  }

  /**
   * Where the path P to Q (a short segment of some other line) crosses this section, as a
   * distance along the section in km, or null if it does not cross within A to B.
   */
  crossing(p: LatLon, q: LatLon): number | null {
    const pv = toVec(p.lat, p.lon);
    const qv = toVec(q.lat, q.lon);
    const sp = dot(pv, this.n);
    const sq = dot(qv, this.n);
    if (sp === 0 && sq === 0) return null;
    if ((sp > 0) === (sq > 0) && sp !== 0 && sq !== 0) return null;
    const f = sp / (sp - sq);
    const x = norm([0, 1, 2].map((i) => pv[i] + f * (qv[i] - pv[i])) as Vec);
    const along = Math.atan2(dot(x, this.t), dot(x, this.a));
    return along >= 0 && along <= this.angle ? along * EARTH_RADIUS_KM : null;
  }
}
