import { defineConfig } from "vitest/config";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumBuild = "node_modules/cesium/Build/Cesium";

// Local development: serve ../pipeline/out at /data/ with HTTP Range support, which PMTiles needs.
function servePipelineOutput(): Plugin {
  const root = resolve(import.meta.dirname, "../pipeline/out");
  return {
    name: "beneath-serve-pipeline-output",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const path = resolve(root, decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, ""));
        if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) return next();
        const size = statSync(path).size;
        const type = path.endsWith(".json") || path.endsWith(".geojson") ? "application/json" : "application/octet-stream";
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Type", type);
        const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
          res.setHeader("Content-Length", end - start + 1);
          createReadStream(path, { start, end }).pipe(res);
        } else {
          res.setHeader("Content-Length", size);
          createReadStream(path).pipe(res);
        }
      });
    },
  };
}

// Relative base so the same build works on github.io/beneath/ and on a custom domain.
export default defineConfig({
  base: "./",
  define: {
    CESIUM_BASE_URL: JSON.stringify("./cesium/"),
  },
  plugins: [
    servePipelineOutput(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumBuild}/Workers`, dest: "cesium", rename: { stripBase: 4 } },
        { src: `${cesiumBuild}/ThirdParty`, dest: "cesium", rename: { stripBase: 4 } },
        { src: `${cesiumBuild}/Assets`, dest: "cesium", rename: { stripBase: 4 } },
        { src: `${cesiumBuild}/Widgets`, dest: "cesium", rename: { stripBase: 4 } },
      ],
    }),
  ],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 6000,
  },
  worker: {
    format: "es",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
