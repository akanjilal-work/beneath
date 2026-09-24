// Fetch every aircraft OpenSky tracks and write the trimmed overview file the Worker serves at
// /aircraft/global. Run by the "Aircraft overview" workflow every 15 minutes: OpenSky does not
// answer requests from Cloudflare's network, so this cannot run inside the Worker itself.
//
// Usage: node --experimental-strip-types scripts/aircraft-overview.ts <out.json>

import { writeFileSync } from "node:fs";
import { OPENSKY_ALL, normaliseOpenSky } from "../src/aircraft.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: aircraft-overview.ts <out.json>");

const res = await fetch(OPENSKY_ALL, {
  headers: { "User-Agent": "beneath-live-feed (+https://github.com/akanjilal-work/beneath)" },
  signal: AbortSignal.timeout(90_000),
});
if (!res.ok) throw new Error(`OpenSky returned ${res.status}`);
const file = normaliseOpenSky(await res.json(), Date.now() / 1000);
// A near-empty answer means an outage; failing here keeps the previous file in R2.
if (file.aircraft.length < 1000) throw new Error(`only ${file.aircraft.length} aircraft; keeping the previous file`);
writeFileSync(out, JSON.stringify(file));
console.log(`aircraft overview: ${file.aircraft.length} aircraft at ${new Date(file.time * 1000).toISOString()}`);
