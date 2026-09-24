// Planetary K-index (Kp): a 0 to 9 measure of geomagnetic disturbance, every 3 hours.
// Accepts both NOAA SWPC formats (array of objects, or header row + arrays) and the
// normalised file the Worker writes.

export interface KpPoint {
  time: string; // ISO, UTC
  kp: number;
}

export interface KpSeries {
  updated: string;
  source: string;
  points: KpPoint[];
}

export function normaliseKp(json: unknown): KpSeries {
  if (json && typeof json === "object" && !Array.isArray(json) && "points" in json) {
    return json as KpSeries;
  }
  if (!Array.isArray(json)) throw new Error("Unexpected Kp format");
  let rows: { time_tag: string; Kp: number }[];
  if (Array.isArray(json[0])) {
    const [header, ...data] = json as (string | number)[][];
    const ti = header.indexOf("time_tag");
    const ki = header.findIndex((h) => String(h).toLowerCase() === "kp");
    rows = data.map((r) => ({ time_tag: String(r[ti]), Kp: Number(r[ki]) }));
  } else {
    rows = (json as Record<string, unknown>[]).map((r) => ({
      time_tag: String(r.time_tag),
      Kp: Number(r.Kp ?? r.kp ?? r.kp_index),
    }));
  }
  const points = rows
    .filter((r) => r.time_tag && Number.isFinite(r.Kp))
    .map((r) => ({ time: r.time_tag.replace(" ", "T").replace(/(\.\d+)?Z?$/, "Z"), kp: r.Kp }))
    .sort((a, b) => a.time.localeCompare(b.time));
  return { updated: new Date().toISOString(), source: "NOAA SWPC", points };
}

export interface KpSummary {
  kp: number;
  time: string;
  level: "quiet" | "unsettled" | "active" | "storm";
  label: string;
  advice: string;
  stale: boolean;
}

export function summariseKp(series: KpSeries, now = Date.now()): KpSummary | null {
  const last = series.points[series.points.length - 1];
  if (!last) return null;
  const kp = last.kp;
  const stale = now - Date.parse(last.time) > 9 * 3600 * 1000;
  if (kp < 3)
    return { kp, time: last.time, stale, level: "quiet", label: "Quiet", advice: "Good conditions for magnetic surveys." };
  if (kp < 4)
    return { kp, time: last.time, stale, level: "unsettled", label: "Unsettled", advice: "Usable, with some noise in magnetic readings." };
  if (kp < 5)
    return { kp, time: last.time, stale, level: "active", label: "Active", advice: "Noisy magnetic readings. Surveys often pause." };
  return { kp, time: last.time, stale, level: "storm", label: `Storm (G${Math.min(5, Math.floor(kp) - 4)})`, advice: "Geomagnetic storm. Magnetic surveys usually stop; aurora likely at high latitudes." };
}

/** Try each source in order (NOAA first, then the Worker's copy) and return the first that works. */
export async function fetchKp(urls: string[]): Promise<KpSeries> {
  let last: unknown = new Error("No Kp source configured");
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Kp feed returned ${res.status}`);
      return normaliseKp(await res.json());
    } catch (err) {
      last = err;
    }
  }
  throw last;
}
