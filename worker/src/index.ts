// Beneath live feed: every 15 minutes, poll NOAA SWPC for the planetary K-index and write a
// normalised live/kp.json to R2. The same Worker also serves that file with CORS headers,
// so the app can read it either from the R2 custom domain or from this Worker's URL.
// It also proxies live aircraft (/aircraft), which the free ADS-B feeds do not serve to browsers.

import { AIRCRAFT_UPSTREAMS, GLOBAL_AIRCRAFT_KEY, aircraftQuery, normaliseAircraft } from "./aircraft";
import { normaliseKp, SWPC_KP_URL } from "./kp";
import { WINDY_PAGES, normaliseWebcams, webcamQuery, windyPageUrl } from "./webcams";

export interface Env {
  DATA: R2Bucket;
  /** Comma-separated list of origins allowed to read live data, or "*". */
  ALLOWED_ORIGINS: string;
  /** Windy webcams API key (a Worker secret); /webcams is unavailable without it. */
  WINDY_API_KEY?: string;
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
      const [head, planes] = await Promise.all([env.DATA.head(KP_KEY), env.DATA.head(GLOBAL_AIRCRAFT_KEY)]);
      return Response.json(
        { ok: true, kpUpdated: head?.uploaded.toISOString() ?? null, globalAircraftUpdated: planes?.uploaded.toISOString() ?? null },
        { headers: { ...cors, "Cache-Control": "no-store" } },
      );
    }

    // Written every 15 minutes by the "Aircraft overview" GitHub workflow (OpenSky does not answer
    // Cloudflare's network, so the Worker cannot fetch it itself).
    if (url.pathname === "/aircraft/global") {
      const obj = await env.DATA.get(GLOBAL_AIRCRAFT_KEY);
      if (!obj) return new Response("Not yet available", { status: 404, headers: cors });
      return new Response(obj.body, {
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=300", ETag: obj.httpEtag },
      });
    }

    if (url.pathname === "/aircraft") {
      const q = aircraftQuery(url.searchParams);
      if (!q) return new Response("Expected lat, lon and r (nautical miles)", { status: 400, headers: cors });
      // Cloudflare caches each upstream call for a few seconds, so many viewers of the same area
      // cost one request. If one network refuses (they rate-limit shared cloud addresses), try the next.
      const failures: string[] = [];
      for (const up of AIRCRAFT_UPSTREAMS) {
        const res = await fetch(up.url(q.lat, q.lon, q.radius), {
          headers: { "User-Agent": "beneath-live-feed (+https://github.com/akanjilal-work/beneath)" },
          cf: { cacheTtl: 8, cacheEverything: true },
        });
        if (!res.ok) {
          failures.push(`${up.name} ${res.status}`);
          continue;
        }
        const file = normaliseAircraft(await res.json(), Date.now() / 1000, up);
        return Response.json(file, { headers: { ...cors, "Cache-Control": "public, max-age=5" } });
      }
      return new Response(`Aircraft sources unavailable: ${failures.join(", ")}`, { status: 502, headers: cors });
    }

    if (url.pathname === "/webcams") {
      if (!env.WINDY_API_KEY) return new Response("Webcams are not configured", { status: 503, headers: cors });
      const q = webcamQuery(url.searchParams);
      if (!q) return new Response("Expected lat, lon and r (kilometres)", { status: 400, headers: cors });
      // Cameras change slowly, so each area is cached for 10 minutes at the edge.
      const pages = await Promise.all(
        Array.from({ length: WINDY_PAGES }, async (_, page) => {
          const res = await fetch(windyPageUrl(q, page), {
            headers: { "x-windy-api-key": env.WINDY_API_KEY!, "User-Agent": "beneath-live-feed (+https://github.com/akanjilal-work/beneath)" },
            cf: { cacheTtl: 600, cacheEverything: true },
          });
          return res.ok ? ((await res.json()) as { webcams?: [] }) : { webcams: [] };
        }),
      );
      return Response.json(normaliseWebcams(pages), { headers: { ...cors, "Cache-Control": "public, max-age=600" } });
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
