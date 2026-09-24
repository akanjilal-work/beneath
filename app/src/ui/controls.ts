import { COMMODITY_GROUPS } from "../data/deposits";
import { DEPTH_GRADIENT, type QuakeIndex } from "../data/quakes";
import { ORBIT_CLASSES } from "../data/satellites";
import type { WebcamSource } from "../data/webcams";
import type { AircraftStatus } from "../render/aircraft";
import { TRAFFIC_ICON, WEBCAM_ICON } from "../render/webcams";
import type { Manifest, RasterEntry } from "../data/manifest";
import { allBoundaryClasses, type PlateModel } from "../data/plates";
import { getRamp } from "../lib/ramps";
import { DEPTH_STOPS, LIVE_OVERLAYS, MAX_DEPTH, type AppState, type OverlayId, type Store } from "../state";
import { $, h } from "./dom";

/** Opacity of each depth stop's layer for a slider position; at most two are non-zero. */
export function depthWeights(depth: number): number[] {
  return DEPTH_STOPS.map((_, i) => Math.max(0, 1 - Math.abs(depth - i)));
}

export function nearestStop(depth: number): number {
  return Math.round(depth);
}

const STOP_HINTS = ["Base imagery only", "EMAG2v3, nT", "EGM2008 free-air, mGal", "PB2002 plates"];

const OVERLAY_LABELS: Record<OverlayId, { label: string; hint: string }> = {
  quakes: { label: "Earthquakes", hint: "M5+ since 1970, plus the past week" },
  deposits: { label: "Mineral deposits", hint: "Government inventories" },
  boundaries: { label: "Plate boundaries", hint: "Bird (2003) PB2002" },
  coastlines: { label: "Coastlines", hint: "Natural Earth" },
  live: { label: "Live survey conditions", hint: "NOAA planetary Kp" },
  satellites: { label: "Satellites", hint: "About 16,000 active, moving live" },
  aircraft: { label: "Aircraft", hint: "Live flights near the view" },
  webcams: { label: "Cameras", hint: "Live images: traffic cameras, and webcams worldwide" },
};

/** What the legend needs to know about the live layers. */
export interface LiveLegend {
  satellites: { count: number; updated: string } | null;
  aircraft: AircraftStatus;
  webcams: { count: number; windy: number; sources: WebcamSource[]; nearby: number } | null;
}

export function setupControls(store: Store, available: Set<OverlayId>) {
  // Depth radios mirror the slider stops.
  const radios = $("depth-radios");
  DEPTH_STOPS.forEach((name, i) => {
    const input = h("input", { type: "radio", name: "depth", value: String(i) });
    input.addEventListener("change", () => store.set({ depth: i }));
    radios.append(h("label", { class: "radio" }, input, h("span", null, name, h("small", null, STOP_HINTS[i]))));
  });

  const checks = $("overlay-checks");
  const liveChecks = $("live-checks");
  for (const id of Object.keys(OVERLAY_LABELS) as OverlayId[]) {
    const isLive = LIVE_OVERLAYS.includes(id);
    // Live layers are always listed; one without its data source is shown switched off.
    if (!available.has(id) && !isLive) continue;
    const input = h("input", { type: "checkbox", value: id, disabled: !available.has(id) });
    input.addEventListener("change", () => store.toggleOverlay(id, input.checked));
    const { label, hint } = OVERLAY_LABELS[id];
    const note = available.has(id) ? hint : "Needs the Beneath live proxy";
    (isLive ? liveChecks : checks).append(h("label", { class: "check" }, input, h("span", null, label, h("small", null, note))));
  }

  const slider = $("depth-slider") as HTMLInputElement;
  slider.max = String(MAX_DEPTH);
  slider.addEventListener("input", () => store.set({ depth: Number(slider.value) }));
  // Snap to the nearest stop on release so shared links land on a clean layer.
  slider.addEventListener("change", () => {
    const v = Number(slider.value);
    const snapped = Math.round(v);
    if (Math.abs(v - snapped) < 0.12) store.set({ depth: snapped });
  });

  const stops = $("depth-stops");
  DEPTH_STOPS.forEach((name, i) => {
    stops.append(h("span", { style: `left:${(i / MAX_DEPTH) * 100}%`, "data-stop": i }, name));
  });

  const ramp = $("ramp-select") as HTMLSelectElement;
  ramp.addEventListener("change", () => store.set({ ramp: ramp.value as AppState["ramp"] }));
  const relief = $("relief-toggle") as HTMLInputElement;
  relief.addEventListener("change", () => store.set({ relief: relief.checked }));

  // Mobile bottom sheet.
  const panel = $("layers-panel");
  const handle = panel.querySelector(".sheet-handle") as HTMLButtonElement;
  handle.addEventListener("click", () => {
    const open = panel.classList.toggle("open");
    handle.setAttribute("aria-expanded", String(open));
  });

  const sync = (s: AppState) => {
    slider.value = String(s.depth);
    const stop = nearestStop(s.depth);
    slider.setAttribute("aria-valuetext", DEPTH_STOPS[stop]);
    radios.querySelectorAll<HTMLInputElement>("input").forEach((r) => (r.checked = Math.abs(Number(r.value) - s.depth) < 0.01));
    stops.querySelectorAll<HTMLElement>("span").forEach((sp) => sp.classList.toggle("on", Number(sp.dataset.stop) === stop));
    for (const group of [checks, liveChecks]) {
      group.querySelectorAll<HTMLInputElement>("input").forEach((c) => (c.checked = !c.disabled && s.overlays.has(c.value as OverlayId)));
    }
    ramp.value = s.ramp;
    relief.checked = s.relief;
  };
  store.subscribe(sync);
  sync(store.state);
}

function fmt(v: number): string {
  const a = Math.abs(v);
  const s = a >= 100 ? Math.round(a).toString() : a.toFixed(0);
  return v < 0 ? `−${s}` : v > 0 ? `+${s}` : "0";
}

function rasterLegend(entry: RasterEntry, rampId: AppState["ramp"]) {
  const ramp = getRamp(entry.id, rampId);
  return h(
    "div",
    { class: "legend-item" },
    h("div", { class: "legend-title" }, h("span", null, entry.name ?? entry.id), h("span", null, entry.units)),
    h("div", { class: "legend-bar", style: `background:${ramp.css}` }),
    h(
      "div",
      { class: "legend-scale" },
      h("span", null, fmt(entry.displayMin)),
      h("span", null, "0"),
      h("span", null, fmt(entry.displayMax)),
    ),
    h("div", { class: "legend-source" }, `${entry.attribution} · ${entry.licence}`),
  );
}

export function renderLegend(
  s: AppState,
  manifest: Manifest,
  rasters: Record<string, RasterEntry | undefined>,
  plates: PlateModel | null,
  quakes: QuakeIndex | null,
  live: LiveLegend,
) {
  const w = depthWeights(s.depth);
  const items: HTMLElement[] = [];
  if (w[1] > 0.05 && rasters.magnetic) items.push(rasterLegend(rasters.magnetic, s.ramp));
  if (w[2] > 0.05 && rasters.gravity) items.push(rasterLegend(rasters.gravity, s.ramp));

  const platesEntry = manifest.layers.find((l) => l.id === "plates");
  if (plates && platesEntry && (s.overlays.has("boundaries") || w[3] > 0.05)) {
    const classes = allBoundaryClasses(plates.presentClasses());
    items.push(
      h(
        "div",
        { class: "legend-item" },
        h("div", { class: "legend-title" }, h("span", null, "Plate boundaries"), h("span", null, `${plates.plates.length || ""} plates`)),
        h(
          "div",
          { class: "legend-keys" },
          classes.map((c) => h("span", null, h("i", { class: "line", style: `background:${c.colour}` }), c.label)),
        ),
        h("div", { class: "legend-source" }, `${platesEntry.attribution} · ${platesEntry.licence}`),
      ),
    );
  }

  const quakesEntry = manifest.layers.find((l) => l.id === "earthquakes");
  if (s.overlays.has("quakes") && quakesEntry && quakes) {
    const catalogue = quakes.quakes.length - quakes.recentCount;
    items.push(
      h(
        "div",
        { class: "legend-item" },
        h("div", { class: "legend-title" }, h("span", null, "Earthquake depth"), h("span", null, s.xray ? "shown at true depth" : "km")),
        h("div", { class: "legend-bar", style: `background:${DEPTH_GRADIENT}` }),
        h("div", { class: "legend-scale" }, h("span", null, "0"), h("span", null, "350"), h("span", null, "700")),
        h(
          "div",
          { class: "legend-source" },
          `${catalogue.toLocaleString()} M5+ since 1970`,
          quakes.recentCount ? ` · ${quakes.recentCount} in the past 7 days (white ring)` : "",
        ),
        h("div", { class: "legend-source" }, `${quakesEntry.attribution} · ${quakesEntry.licence}`),
      ),
    );
  }

  const depositsEntry = manifest.layers.find((l) => l.id === "deposits");
  if (s.overlays.has("deposits") && depositsEntry) {
    items.push(
      h(
        "div",
        { class: "legend-item" },
        h("div", { class: "legend-title" }, h("span", null, "Deposits"), h("span", null, "zoom in for more")),
        h(
          "div",
          { class: "legend-keys" },
          COMMODITY_GROUPS.map((g) => h("span", null, h("i", { style: `background:${g.colour}` }), g.label)),
        ),
        h("div", { class: "legend-source" }, `${depositsEntry.attribution} · ${depositsEntry.licence}`),
      ),
    );
  }
  if (s.overlays.has("satellites") && live.satellites) {
    items.push(
      h(
        "div",
        { class: "legend-item" },
        h("div", { class: "legend-title" }, h("span", null, "Satellites"), h("span", null, live.satellites.count.toLocaleString())),
        h("div", { class: "legend-keys" }, ORBIT_CLASSES.map((c) => h("span", null, h("i", { style: `background:${c.colour}` }), c.label))),
        h("div", { class: "legend-source" }, `Orbits from CelesTrak, ${live.satellites.updated.slice(0, 10)} · positions computed live`),
      ),
    );
  }
  // "off" means not polling: switched off, or the live proxy is not configured.
  if (s.overlays.has("aircraft") && live.aircraft.state !== "off") {
    const a = live.aircraft;
    const status =
      a.state === "ok"
        ? `${a.count} live in view`
        : a.state === "overview"
          ? `${a.count.toLocaleString()} worldwide`
          : a.state === "error"
            ? "feed unavailable"
            : "";
    items.push(
      h(
        "div",
        { class: "legend-item" },
        h("div", { class: "legend-title" }, h("span", null, "Aircraft"), h("span", null, status)),
        h("div", { class: "legend-keys" }, h("span", null, h("i", { style: "background:#ffd166" }), "Flying"), h("span", null, h("i", { style: "background:#9aa6bd" }), "On the ground")),
        h(
          "div",
          { class: "legend-source" },
          a.state === "overview"
            ? `OpenSky Network overview from ${new Date(a.updated).toISOString().slice(11, 16)} UTC, refreshed every 15 min · zoom in for live positions`
            : `${a.state === "ok" ? a.source : "adsb.lol / adsb.fi"} community receivers · refreshed every 10 s`,
        ),
      ),
    );
  }
  if (s.overlays.has("webcams") && live.webcams) {
    items.push(
      h(
        "div",
        { class: "legend-item" },
        h("div", { class: "legend-title" }, h("span", null, "Cameras"), h("span", null, "zoom in for more")),
        h(
          "div",
          { class: "legend-keys" },
          h("span", null, h("img", { class: "legend-icon", src: TRAFFIC_ICON, alt: "" }), `Traffic cameras (${live.webcams.count.toLocaleString()})`),
          h("span", null, h("img", { class: "legend-icon", src: WEBCAM_ICON, alt: "" }), `Webcams (${(live.webcams.windy + live.webcams.nearby).toLocaleString()})`),
        ),
        h(
          "div",
          { class: "legend-source" },
          live.webcams.sources.map((x) => x.name.replace(/ \(.*\)/, "")).join(" · "),
          " · ",
          h("a", { href: "https://www.windy.com/webcams", target: "_blank", rel: "noopener" }, "Webcams provided by windy.com"),
        ),
      ),
    );
  }
  $("legend").replaceChildren(...items);
}

export function renderSources(manifest: Manifest) {
  const list = manifest.layers.map((l) =>
    h(
      "div",
      null,
      h("strong", null, l.name ?? l.id),
      h("span", null, `${l.attribution} · ${l.licence}`),
      l.citation ? h("span", null, h("br"), l.citation) : null,
      l.sourceUrl ? h("span", null, " · ", h("a", { href: l.sourceUrl, target: "_blank", rel: "noopener" }, "source")) : null,
    ),
  );
  list.push(
    h(
      "div",
      null,
      h("strong", null, "Satellites"),
      h("span", null, "Orbital elements from CelesTrak, refreshed daily; positions computed in the browser with SGP4"),
    ),
    h(
      "div",
      null,
      h("strong", null, "Aircraft"),
      h(
        "span",
        null,
        "Live: adsb.lol (Open Database License 1.0), with adsb.fi open data as a fallback. Worldwide overview: OpenSky Network, refreshed every 15 minutes. Community ADS-B receivers.",
      ),
    ),
    h(
      "div",
      null,
      h("strong", null, "Cameras"),
      h(
        "span",
        null,
        "Caltrans, 511NY and Ontario 511 traffic cameras (images belong to each agency); webcams worldwide provided by ",
        h("a", { href: "https://www.windy.com/webcams", target: "_blank", rel: "noopener" }, "windy.com"),
      ),
    ),
    h(
      "div",
      null,
      h("strong", null, "US close-up imagery"),
      h("span", null, "USGS The National Map: Orthoimagery · Public domain"),
    ),
    h(
      "div",
      null,
      h("strong", null, "Earthquakes in the past 7 days"),
      h("span", null, "USGS earthquake feed (M2.5 and larger), refreshed every 10 minutes · Public domain"),
    ),
    h(
      "div",
      null,
      h("strong", null, "Live survey conditions"),
      h("span", null, "Planetary K-index, NOAA Space Weather Prediction Center · Public domain"),
    ),
    h(
      "div",
      null,
      h("strong", null, "Satellite imagery"),
      h(
        "span",
        null,
        "Sentinel-2 cloudless 2024 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024) · CC BY-NC-SA 4.0",
      ),
    ),
    h(
      "div",
      null,
      h("strong", null, "Terrain"),
      h(
        "span",
        null,
        "Terrain Tiles on AWS (SRTM, GMTED2010, ETOPO1, 3DEP, Copernicus DEM and others) · ",
        h("a", { href: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md", target: "_blank", rel: "noopener" }, "full attribution"),
      ),
    ),
    h(
      "div",
      null,
      h("strong", null, "Base imagery (far view fallback)"),
      h("span", null, "Natural Earth II, shipped with CesiumJS · Public domain"),
    ),
  );
  $("sources-list").replaceChildren(h("div", { class: "sources" }, list));
}
