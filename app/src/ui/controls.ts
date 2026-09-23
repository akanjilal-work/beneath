import { COMMODITY_GROUPS } from "../data/deposits";
import type { Manifest, RasterEntry } from "../data/manifest";
import { allBoundaryClasses, type PlateModel } from "../data/plates";
import { getRamp } from "../lib/ramps";
import { DEPTH_STOPS, MAX_DEPTH, type AppState, type OverlayId, type Store } from "../state";
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
  deposits: { label: "Mineral deposits", hint: "Government inventories" },
  boundaries: { label: "Plate boundaries", hint: "Bird (2003) PB2002" },
  coastlines: { label: "Coastlines", hint: "Natural Earth" },
  live: { label: "Live survey conditions", hint: "NOAA planetary Kp" },
};

export function setupControls(store: Store, available: Set<OverlayId>) {
  // Depth radios mirror the slider stops.
  const radios = $("depth-radios");
  DEPTH_STOPS.forEach((name, i) => {
    const input = h("input", { type: "radio", name: "depth", value: String(i) });
    input.addEventListener("change", () => store.set({ depth: i }));
    radios.append(h("label", { class: "radio" }, input, h("span", null, name, h("small", null, STOP_HINTS[i]))));
  });

  const checks = $("overlay-checks");
  for (const id of Object.keys(OVERLAY_LABELS) as OverlayId[]) {
    if (!available.has(id)) continue;
    const input = h("input", { type: "checkbox", value: id });
    input.addEventListener("change", () => store.toggleOverlay(id, input.checked));
    const { label, hint } = OVERLAY_LABELS[id];
    checks.append(h("label", { class: "check" }, input, h("span", null, label, h("small", null, hint))));
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
    checks.querySelectorAll<HTMLInputElement>("input").forEach((c) => (c.checked = s.overlays.has(c.value as OverlayId)));
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
      h("strong", null, "Live survey conditions"),
      h("span", null, "Planetary K-index, NOAA Space Weather Prediction Center · Public domain"),
    ),
    h(
      "div",
      null,
      h("strong", null, "Base imagery"),
      h("span", null, "Natural Earth II, shipped with CesiumJS · Public domain"),
    ),
  );
  $("sources-list").replaceChildren(h("div", { class: "sources" }, list));
}
