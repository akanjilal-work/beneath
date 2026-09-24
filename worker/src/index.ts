// Beneath live feed: every 15 minutes, poll NOAA SWPC for the planetary K-index and write a
// normalised live/kp.json to R2. The same Worker also serves that file with CORS headers,
// so the app can read it either from the R2 custom domain or from this Worker's URL.
// It also proxies live aircraft (/aircraft), which the free ADS-B feeds do not serve to browsers.

import { AIRCRAFT_UPSTREAM, aircraftQuery, normaliseAircraft } from "./aircraft";
import { normaliseKp, SWPC_KP_URL } from "./kp";

export interface Env {
  DATA: R2Bucket;
  /** Comma-separated list of origins allowed to read live data, or "*". */
  ALLOWED_ORIGINS: string;
}

const KP_KEY = "live/kp.json";

async function refresh(env: Env): Promise<string> {
  const res = await fetch(SWPC_KP_URL, {
    headers: { "User-Agent": "beneath-live-feed (+https://github.com/akanjilal-work/beneath)" },
    cf: { cacheTtl: 60 },
  });
  if (!res.ok) throw new Error(`SWPC returned ${res.status}`);
  const file = normaliseKp(await res.json(), new Date());
  await env.DATA.put(KP_KEY, JSON.stringify(file), {
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=60" },
  });
  return file.points[file.points.length - 1].time;
}

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const allow = allowed.includes("*") ? "*" : origin && allowed.includes(origin) ? origin : "";
  return allow
    ? { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", Vary: "Origin" }
    : {};
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // A failed poll leaves the previous file in place; the app marks old data as stale.
    ctx.waitUntil(
      refresh(env).then(
        (latest) => console.log(`kp refreshed, latest ${latest}`),
        (err) => console.error(`kp refresh failed: ${err}`),
      ),
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request.headers.get("Origin"));
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      const head = await env.DATA.head(KP_KEY);
      return Response.json(
        { ok: true, kpUpdated: head?.uploaded.toISOString() ?? null },
        { headers: { ...cors, "Cache-Control": "no-store" } },
      );
    }

    if (url.pathname === "/aircraft") {
      const q = aircraftQuery(url.searchParams);
      if (!q) return new Response("Expected lat, lon and r (nautical miles)", { status: 400, headers: cors });
      // Cloudflare caches the upstream call for a few seconds, so many viewers of the same area
      // cost one request.
      const res = await fetch(`${AIRCRAFT_UPSTREAM}/${q.lat}/${q.lon}/${q.radius}`, {
        headers: { "User-Agent": "beneath-live-feed (+https://github.com/akanjilal-work/beneath)" },
        cf: { cacheTtl: 8, cacheEverything: true },
      });
      if (!res.ok) return new Response(`Aircraft source returned ${res.status}`, { status: 502, headers: cors });
      const file = normaliseAircraft(await res.json(), Date.now() / 1000);
      return Response.json(file, { headers: { ...cors, "Cache-Control": "public, max-age=5" } });
    }

    if (url.pathname === `/${KP_KEY}`) {
      const obj = await env.DATA.get(KP_KEY);
      if (!obj) return new Response("Not yet available", { status: 404, headers: cors });
      return new Response(request.method === "HEAD" ? null : obj.body, {
        headers: {
          ...cors,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
          ETag: obj.httpEtag,
        },
      });
    }

    return new Response("Not found", { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;
