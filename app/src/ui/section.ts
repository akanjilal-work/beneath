// The cross-section panel: a vertical slice along a great circle. Top bands show the ground
// profile and the magnetic and gravity readings along the line; the main band plots every
// earthquake within the swath at its distance along the line and its depth.

import type { PlateModel } from "../data/plates";
import { depthColour, describeQuake, magnitudePixels, type QuakeIndex } from "../data/quakes";
import { formatLatLon } from "../lib/geo";
import { Section } from "../lib/section";
import { SECTION_WIDTHS, type SectionState } from "../state";
import { formatDistance } from "./copy";
import { $, h } from "./dom";

export interface SectionInputs {
  state: SectionState;
  quakes: QuakeIndex | null;
  plates: PlateModel | null;
  /** Ground height in metres (negative below sea level) at each point. */
  heights: (points: { lat: number; lon: number }[], lengthKm: number) => Promise<number[]>;
  magnetic?: (lon: number, lat: number) => Promise<number>;
  gravity?: (lon: number, lat: number) => Promise<number>;
  xray: boolean;
}

export interface SectionActions {
  onWidth: (w: number) => void;
  onClose: () => void;
  onRedraw: () => void;
  onXray: (on: boolean) => void;
  onCopy: () => void;
}

const SAMPLES = 200;
const NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: (Node | string)[]) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) el.append(c);
  return el;
}

/** Round steps (1, 2, 5 x 10^n) giving roughly `count` ticks across a range. */
export function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function linePath(xs: number[], ys: number[]): string {
  let d = "";
  let pen = false;
  xs.forEach((x, i) => {
    const y = ys[i];
    if (!Number.isFinite(y)) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}

let renderId = 0;

export async function renderSection(input: SectionInputs, actions: SectionActions) {
  const id = ++renderId;
  const panel = $("section-panel");
  const body = $("section-body");
  const { a, b, w } = input.state;
  const section = new Section(a, b);
  const points = section.sample(SAMPLES);

  // Header: what the slice is, swath width, and actions.
  const width = h(
    "select",
    { id: "section-width", "aria-label": "Swath half-width" },
    SECTION_WIDTHS.map((v) => h("option", { value: v, selected: v === w }, `±${v} km`)),
  );
  width.addEventListener("change", () => actions.onWidth(Number(width.value)));
  const xray = h("input", { type: "checkbox", checked: input.xray });
  xray.addEventListener("change", () => actions.onXray(xray.checked));
  const redraw = h("button", { class: "button", type: "button" }, "Redraw");
  redraw.addEventListener("click", actions.onRedraw);
  const copy = h("button", { class: "button", type: "button" }, "Copy link");
  copy.addEventListener("click", () => {
    actions.onCopy();
    copy.textContent = "Link copied";
    setTimeout(() => (copy.textContent = "Copy link"), 1600);
  });
  $("section-head").replaceChildren(
    h(
      "div",
      { class: "section-title" },
      h("h2", { id: "section-title" }, "Cross-section"),
      h("span", null, `${formatDistance(section.lengthKm)} · A ${formatLatLon(a.lat, a.lon)} → B ${formatLatLon(b.lat, b.lon)}`),
    ),
    h(
      "div",
      { class: "section-tools" },
      h("label", { class: "row-control compact" }, h("span", null, "Earthquakes within"), width),
      h("label", { class: "check compact" }, xray, h("span", null, "See beneath")),
      redraw,
      copy,
    ),
  );
  $("section-close").onclick = actions.onClose;
  panel.hidden = false;
  body.replaceChildren(h("p", { class: "muted section-loading" }, "Measuring the section…"));

  // Profiles along the line. Missing readings (offline tiles, no data) show as gaps.
  const safe = (f?: (lon: number, lat: number) => Promise<number>) =>
    f ? Promise.all(points.map((p) => f(p.lon, p.lat).catch(() => NaN))) : Promise.resolve(null);
  const [heights, mag, grav] = await Promise.all([
    input.heights(points, section.lengthKm).catch(() => points.map(() => NaN)),
    safe(input.magnetic),
    safe(input.gravity),
  ]);
  if (id !== renderId) return;

  const hits = input.quakes ? input.quakes.inSwath(section, w) : [];
  const crossings: { km: number; label: string; colour: string }[] = [];
  if (input.plates) {
    for (const bd of input.plates.boundaries) {
      for (const line of bd.lines) {
        for (let i = 1; i < line.length; i++) {
          const km = section.crossing({ lon: line[i - 1][0], lat: line[i - 1][1] }, { lon: line[i][0], lat: line[i][1] });
          if (km !== null && !crossings.some((c) => Math.abs(c.km - km) < 25)) {
            crossings.push({ km, label: bd.cls.label, colour: bd.cls.colour });
          }
        }
      }
    }
  }

  // --- layout ----------------------------------------------------------------------------
  // Draw at the panel's real width so text stays readable on phones.
  const W = Math.max(300, Math.round(body.clientWidth || 900));
  const narrow = W < 520;
  const L = narrow ? 82 : 86;
  const R = narrow ? 8 : 18;
  const plotW = W - L - R;
  const bands = { elev: 56, mag: 36, grav: 36, gap: 9 };
  const depthTop = bands.elev + bands.mag + bands.grav + bands.gap * 3 + 14;
  const depthH = 180;
  const H = depthTop + depthH + 34;
  const x = (km: number) => L + (km / section.lengthKm) * plotW;
  const xs = points.map((_, i) => x((i / (SAMPLES - 1)) * section.lengthKm));

  const maxQuake = hits.reduce((m, hit) => Math.max(m, hit.quake.depthKm), 0);
  const maxDepth = Math.min(700, Math.max(100, Math.ceil(maxQuake / 100) * 100));
  const yDepth = (d: number) => depthTop + (d / maxDepth) * depthH;

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "section-chart", role: "img", "aria-labelledby": "section-title" });

  // A band: title and range on the left, a zero line, and the profile.
  const band = (top: number, height: number, title: string, units: string, values: number[] | null, colour: string, area = false) => {
    root.append(svg("text", { x: 8, y: top + 13, class: "band-title" }, title));
    if (!values || values.every((v) => !Number.isFinite(v))) {
      root.append(svg("text", { x: 8, y: top + 28, class: "band-range" }, "no data"));
      return;
    }
    const finite = values.filter(Number.isFinite);
    let lo = Math.min(...finite);
    let hi = Math.max(...finite);
    if (hi - lo < 1e-6) [lo, hi] = [lo - 1, hi + 1];
    const y = (v: number) => top + height - ((v - lo) / (hi - lo)) * height;
    root.append(svg("text", { x: 8, y: top + 27, class: "band-range" }, `${fmt(lo, units)} to`));
    root.append(svg("text", { x: 8, y: top + 39, class: "band-range" }, fmt(hi, units)));
    root.append(svg("rect", { x: L, y: top, width: plotW, height, class: "band-bg" }));
    if (lo < 0 && hi > 0) root.append(svg("line", { x1: L, x2: L + plotW, y1: y(0), y2: y(0), class: "zero" }));
    const d = linePath(xs, values.map((v) => (Number.isFinite(v) ? y(v) : NaN)));
    if (area) root.append(svg("path", { d: `${d}L${xs[xs.length - 1]} ${top + height}L${xs[0]} ${top + height}Z`, fill: colour, opacity: 0.22 }));
    root.append(svg("path", { d, fill: "none", stroke: colour, "stroke-width": 1.6 }));
  };
  const fmt = (v: number, units: string) => {
    const n = units === "m" && Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} ${units}`;
    return n.replace("-", "−");
  };

  let top = 6;
  band(top, bands.elev, "Elevation", "m", heights, "#c7a26b", true);
  top += bands.elev + bands.gap;
  band(top, bands.mag, "Magnetic", "nT", mag, "#7cc4ff");
  top += bands.mag + bands.gap;
  band(top, bands.grav, "Gravity", "mGal", grav, "#f4d03f");

  // Depth band: grid, plate boundary markers, then earthquakes.
  root.append(svg("text", { x: 8, y: depthTop + 13, class: "band-title" }, narrow ? "Quakes" : "Earthquakes"));
  root.append(svg("text", { x: 8, y: depthTop + 28, class: "band-range" }, `depth, km`));
  root.append(svg("rect", { x: L, y: depthTop, width: plotW, height: depthH, class: "band-bg" }));
  const dStep = niceStep(maxDepth, 5);
  for (let d = 0; d <= maxDepth + 1e-6; d += dStep) {
    root.append(svg("line", { x1: L, x2: L + plotW, y1: yDepth(d), y2: yDepth(d), class: "grid" }));
    if (d > 0) root.append(svg("text", { x: L - 6, y: yDepth(d) + 4, class: "tick", "text-anchor": "end" }, String(d)));
  }
  for (const c of crossings) {
    root.append(
      svg("line", { x1: x(c.km), x2: x(c.km), y1: 6, y2: depthTop + depthH, stroke: c.colour, class: "boundary" }, svg("title", {}, c.label)),
    );
    root.append(svg("text", { x: x(c.km) + 4, y: depthTop + depthH - 6, class: "boundary-label", fill: c.colour }, c.label));
  }
  // Smallest first so large events sit on top.
  for (const hit of [...hits].sort((p, q) => p.quake.mag - q.quake.mag)) {
    const q = hit.quake;
    const dot = svg("circle", {
      cx: x(hit.alongKm).toFixed(1),
      cy: yDepth(Math.min(q.depthKm, maxDepth)).toFixed(1),
      r: Math.max(1.6, magnitudePixels(q.mag) * 0.55).toFixed(1),
      fill: depthColour(q.depthKm),
      class: q.recent ? "quake recent" : "quake",
    });
    dot.append(svg("title", {}, `${q.name ? `${q.name}\n` : ""}${describeQuake(q)}\n${Math.round(Math.abs(hit.offsetKm))} km from the line`));
    root.append(dot);
  }

  // Distance axis.
  const kmStep = niceStep(section.lengthKm, Math.max(2, Math.round(plotW / 110)));
  const axisY = depthTop + depthH;
  for (let km = 0; km <= section.lengthKm + 1e-6; km += kmStep) {
    root.append(svg("line", { x1: x(km), x2: x(km), y1: axisY, y2: axisY + 4, class: "grid" }));
    root.append(svg("text", { x: x(km), y: axisY + 16, class: "tick", "text-anchor": "middle" }, `${Math.round(km)}`));
  }
  root.append(svg("text", { x: L + plotW / 2, y: axisY + 30, class: "tick", "text-anchor": "middle" }, "km along the line"));
  root.append(svg("text", { x: L, y: axisY + 30, class: "end-label" }, "A"));
  root.append(svg("text", { x: L + plotW, y: axisY + 30, class: "end-label", "text-anchor": "end" }, "B"));

  // How much the depth axis is stretched relative to distance, so the picture is read honestly.
  const stretch = section.lengthKm / plotW / (maxDepth / depthH);
  const deepest = hits.reduce((m, hit) => Math.max(m, hit.quake.depthKm), 0);
  const summary =
    hits.length === 0
      ? `No M5+ earthquakes since 1970 within ±${w} km of this line.`
      : `${hits.length.toLocaleString()} earthquakes within ±${w} km · deepest ${Math.round(deepest)} km${
          hits.some((hit) => hit.quake.recent) ? " · white rings are the past 7 days" : ""
        }`;
  const scale =
    stretch > 1.25 ? `Depth stretched ×${stretch.toFixed(stretch < 10 ? 1 : 0)}` : stretch < 0.8 ? `Depth squeezed ×${(1 / stretch).toFixed(1)}` : "True scale";
  const touch = window.matchMedia("(pointer: coarse)").matches;
  body.replaceChildren(root, h("p", { class: "section-note" }, `${summary} · ${scale}${touch ? "" : " · hover a point for details"}`));
}

export function hideSection() {
  renderId++;
  $("section-panel").hidden = true;
}
