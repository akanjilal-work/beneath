// Daily snapshot of slow-changing live sources, run by the deploy workflow (and on a schedule):
//   satellites.json  orbital elements for active satellites (CelesTrak), propagated in the browser
//   webcams.json     public traffic camera locations and image links (Caltrans, 511NY)
// CelesTrak does not allow cross-origin reads, and camera lists change rarely, so a daily copy
// next to the app is enough; the positions and camera images themselves are live in the browser.
//
// Usage: node scripts/snapshot-live.mjs <outDir> [fallbackBaseUrl]
// A source that fails falls back to the copy already published at fallbackBaseUrl (CelesTrak,
// for one, refuses a second download within its 2-hour update cycle), and failing that is
// skipped with a warning, so a feed outage never breaks the deploy.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
const fallbackBase = process.argv[3];
if (!out) {
  console.error("usage: node scripts/snapshot-live.mjs <outDir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const UA = { "User-Agent": "beneath-snapshot (+https://github.com/akanjilal-work/beneath)" };
const now = new Date().toISOString();

async function get(url, as = "json") {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return as === "json" ? res.json() : res.text();
}

// --- satellites ------------------------------------------------------------------------
function parseTle(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const sats = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (l1?.startsWith("1 ") && l2?.startsWith("2 ")) sats.push([name.trim(), l1, l2]);
  }
  return sats;
}

async function satellites() {
  const text = await get("https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle", "text");
  const sats = parseTle(text);
  if (sats.length < 1000) throw new Error(`only ${sats.length} satellites parsed`);
  const doc = { updated: now, source: "CelesTrak", sourceUrl: "https://celestrak.org/", sats };
  writeFileSync(join(out, "satellites.json"), JSON.stringify(doc));
  console.log(`[live] satellites: ${sats.length}`);
}

// --- webcams ---------------------------------------------------------------------------
const SOURCES = [
  { id: "caltrans", name: "Caltrans (California)", url: "https://cwwp2.dot.ca.gov/", updateMinutes: 5 },
  { id: "511ny", name: "511NY (New York State)", url: "https://511ny.org/", updateMinutes: 2 },
];

async function caltrans() {
  const cams = [];
  for (let d = 1; d <= 12; d++) {
    const dd = String(d).padStart(2, "0");
    try {
      const doc = await get(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`);
      for (const { cctv: c } of doc.data) {
        const img = c.imageData?.static?.currentImageURL;
        const lat = Number(c.location?.latitude);
        const lon = Number(c.location?.longitude);
        if (c.inService !== "true" || !img || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        cams.push([round(lon), round(lat), c.location.locationName.replace(/^\S+\s+--\s+/, ""), img, 0]);
      }
    } catch (err) {
      console.warn(`[live] caltrans district ${d} skipped: ${err.message}`);
    }
  }
  return cams;
}

async function ny() {
  const list = await get("https://511ny.org/api/getcameras?format=json");
  return list
    .filter((c) => !c.Disabled && !c.Blocked && c.Url && Number.isFinite(c.Latitude) && Number.isFinite(c.Longitude))
    .map((c) => [round(c.Longitude), round(c.Latitude), c.Name, c.Url, 1]);
}

const round = (v) => Math.round(v * 1e5) / 1e5;

async function webcams() {
  const parts = await Promise.allSettled([caltrans(), ny()]);
  const cams = [];
  parts.forEach((p, i) => {
    if (p.status === "fulfilled") cams.push(...p.value);
    else console.warn(`[live] ${SOURCES[i].id} skipped: ${p.reason?.message ?? p.reason}`);
  });
  if (!cams.length) throw new Error("no cameras from any source");
  const doc = { updated: now, fields: ["lon", "lat", "name", "image", "source"], sources: SOURCES, cams };
  writeFileSync(join(out, "webcams.json"), JSON.stringify(doc));
  console.log(`[live] webcams: ${cams.length}`);
}

async function withFallback(file, build) {
  try {
    await build();
  } catch (err) {
    console.warn(`[live] ${file}: ${err.message}`);
    if (!fallbackBase) return;
    try {
      const text = await get(new URL(file, fallbackBase).toString(), "text");
      JSON.parse(text);
      writeFileSync(join(out, file), text);
      console.log(`[live] ${file}: kept the published copy`);
    } catch (e) {
      console.warn(`[live] ${file}: no published copy either (${e.message})`);
    }
  }
}

await Promise.all([withFallback("satellites.json", satellites), withFallback("webcams.json", webcams)]);
