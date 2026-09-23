# 06. Hosting and deployment

## Summary

| Piece | Host today | Upgrade path | Cost |
|---|---|---|---|
| App | GitHub Pages (`akanjilal-work.github.io/beneath`) | Custom domain `beneath.akanjilal.dev` | Free |
| Tiles and JSON | GitHub Pages, same origin as the app, copied in from a GitHub Release at deploy time | Cloudflare R2 public bucket on `data.beneath.akanjilal.dev` | Free |
| Live Kp | Browser reads NOAA SWPC directly (CORS allowed) | Cloudflare Worker cron writing `live/kp.json` to R2 | Free |
| Pipeline | Local machine | Manual GitHub Action | Free |

## Why tiles are served from Pages for now

The plan put tiles on R2 from day one. For launch they ship inside the Pages artifact instead, because that needs no extra account and the whole data set fits:

| File | Size |
|---|---|
| `magnetic.v1.pmtiles` (z0 to z6) | ~147 MB |
| `gravity.v1.pmtiles` (z0 to z6) | ~222 MB |
| deposits, places, plates, coastlines JSON | ~17 MB |

That is about 390 MB, inside the 1 GB Pages site limit. GitHub Pages honours HTTP `Range` requests, which PMTiles needs.

Binary tiles never enter git history. They live as assets on a GitHub Release (`data-v1`), and the `Deploy app` workflow downloads that release into `dist/data/` before publishing.

**Move to R2 when** traffic approaches the Pages soft bandwidth limit (100 GB per month), or a new layer would push the site past 1 GB. The switch needs one variable and no code change (see below).

## Deploy flow

### App

1. Push to `main` (changes under `app/`), or run **Deploy app** manually.
2. The workflow runs tests, builds `app/` with Vite, downloads the data release into `dist/data/`, and deploys to Pages.

### Data

1. Run the pipeline locally for the changed layer (`pipeline/README.md`).
2. Bump the file version (for example `magnetic.v2.pmtiles`) and `layers.json`.
3. Publish a new release: `gh release create data-v2 pipeline/out/* --title "Data v2"`.
4. Set the repository variable `DATA_RELEASE=data-v2`. Publishing a release triggers **Deploy app** automatically.

Old files stay on their old release, so rolling back is changing `DATA_RELEASE` back.

### Worker (optional)

1. `wrangler deploy` from `worker/`, or push to `main` with the `CLOUDFLARE_API_TOKEN` secret set.
2. R2 binding configured in `wrangler.toml`, no credentials in the repo.

## Moving tiles to R2

1. Cloudflare dashboard, then **R2**, then **Create bucket** `beneath-data`.
2. Bucket **Settings**, then **Custom domains**, then connect `data.beneath.akanjilal.dev` (the zone must be on Cloudflare; the DNS record is created for you).
3. Bucket **CORS policy**:

   ```json
   [{ "AllowedOrigins": ["https://akanjilal-work.github.io", "https://beneath.akanjilal.dev"],
      "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["Range", "If-Match", "If-None-Match"],
      "ExposeHeaders": ["ETag", "Content-Range", "Content-Length"], "MaxAgeSeconds": 86400 }]
   ```

4. Upload: `npx wrangler r2 object put beneath-data/magnetic.v1.pmtiles --file pipeline/out/magnetic.v1.pmtiles --remote` (repeat per file, or use `rclone`).
5. Cache rules: long cache (`max-age=31536000, immutable`) for versioned `*.v*.pmtiles`, 60 s for `layers.json` and `live/*.json`.
6. Set the repository variable `VITE_DATA_BASE_URL=https://data.beneath.akanjilal.dev/` and re-run **Deploy app**. With that variable set, the workflow no longer bundles the release.

## Custom domain for the app

1. Cloudflare DNS for `akanjilal.dev`: add a `CNAME` record `beneath` pointing to `akanjilal-work.github.io`, **DNS only** (grey cloud), so GitHub can issue the TLS certificate.
2. GitHub repository **Settings**, then **Pages**, then **Custom domain**: `beneath.akanjilal.dev`, then tick **Enforce HTTPS** once the certificate is issued.
3. Add `https://beneath.akanjilal.dev` to the Worker's `ALLOWED_ORIGINS` and the R2 CORS policy (already listed in both).

The app uses relative paths throughout, so it needs no rebuild for the domain change.

## Secrets and variables

| Name | Kind | Needed for |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | Worker deploy from CI only. Scope it to Workers Scripts edit and the one R2 bucket. |
| `DATA_RELEASE` | Variable | Which data release to bundle (default `data-v1`). |
| `VITE_DATA_BASE_URL` | Variable | Serve tiles from R2 instead of Pages. |
| `VITE_LIVE_KP_URL` | Variable | Read Kp from the Worker instead of NOAA directly. |

The app itself has no secrets.
