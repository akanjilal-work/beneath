// Normalise the NOAA SWPC planetary K-index feed into the small, stable shape the app reads.
// NOAA has shipped this product both as a header row plus arrays and as an array of objects,
// so accept either and reject anything else rather than publishing garbage.

export interface KpPoint {
  time: string; // ISO 8601, UTC
  kp: number;
}

export interface KpFile {
  updated: string;
  source: string;
  sourceUrl: string;
  points: KpPoint[];
}

export const SWPC_KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";

function toIso(tag: string): string {
  return tag.trim().replace(" ", "T").replace(/(\.\d+)?Z?$/, "Z");
}

export function normaliseKp(json: unknown, now: Date): KpFile {
  if (!Array.isArray(json) || json.length === 0) throw new Error("Kp feed is not a non-empty array");
  let rows: { time: unknown; kp: unknown }[];
  if (Array.isArray(json[0])) {
    const header = (json[0] as unknown[]).map((h) => String(h).toLowerCase());
    const ti = header.indexOf("time_tag");
    const ki = header.indexOf("kp");
    if (ti < 0 || ki < 0) throw new Error("Kp feed header missing time_tag or Kp");
    rows = (json.slice(1) as unknown[][]).map((r) => ({ time: r[ti], kp: r[ki] }));
  } else {
    rows = (json as Record<string, unknown>[]).map((r) => ({ time: r.time_tag, kp: r.Kp ?? r.kp }));
  }

  const points: KpPoint[] = [];
  for (const r of rows) {
    const kp = Number(r.kp);
    if (typeof r.time !== "string" || !Number.isFinite(kp) || kp < 0 || kp > 9) continue;
    const time = toIso(r.time);
    if (Number.isNaN(Date.parse(time))) continue;
    points.push({ time, kp: Math.round(kp * 100) / 100 });
  }
  if (points.length === 0) throw new Error("Kp feed had no valid rows");
  points.sort((a, b) => a.time.localeCompare(b.time));
  return { updated: now.toISOString(), source: "NOAA SWPC", sourceUrl: SWPC_KP_URL, points: points.slice(-56) };
}
