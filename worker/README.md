# worker

Cloudflare Worker that runs every 15 minutes, polls the NOAA SWPC planetary K-index feed, validates and normalises it, and writes `live/kp.json` to the `beneath-data` R2 bucket. It also serves that file (with CORS for the app origins) at `/live/kp.json`, plus a `/health` endpoint.

It also proxies **live aircraft** at `/aircraft?lat=..&lon=..&r=..` (radius in nautical miles, up to 250). The free adsb.lol feed (ODbL) does not allow cross-origin reads, so the Worker fetches it, keeps only what the globe draws, rounds the request so nearby views share a few seconds of Cloudflare cache, and adds CORS. The app's aircraft layer needs this Worker.

The Worker is **optional**. NOAA's feed allows cross-origin requests, so the app reads it directly unless `VITE_LIVE_KP_URL` points at this Worker or the R2 copy. Deploying the Worker adds schema validation and insulates the app from NOAA format changes (a bad poll keeps the last good file, and the app marks old data as stale).

## Output

```json
{ "updated": "2026-09-22T12:00:03.000Z", "source": "NOAA SWPC",
  "sourceUrl": "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  "points": [{ "time": "2026-09-22T09:00:00Z", "kp": 2.33 }] }
```

## Commands

```bash
npm ci
npm test            # normaliser tests
npm run dev         # local, with /__scheduled to trigger the cron
npx wrangler deploy # needs a Cloudflare login or CLOUDFLARE_API_TOKEN
```

## Deploy

1. Create the R2 bucket once: `npx wrangler r2 bucket create beneath-data`.
2. `npx wrangler deploy`, or push to `main` with the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets set (the `Deploy worker` workflow skips cleanly without them).
3. Point the app at it: set the repository variable `VITE_LIVE_PROXY_URL` to `https://beneath-live.<account>.workers.dev` (for aircraft) and, optionally, `VITE_LIVE_KP_URL` to `https://beneath-live.<account>.workers.dev/live/kp.json`, then re-run `Deploy app`.

Observatory data (INTERMAGNET) is not polled yet; its display terms are unverified (see `docs/03-data-sources.md`).
