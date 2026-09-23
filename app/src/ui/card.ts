import { statusLabel, type Deposit } from "../data/deposits";
import type { Boundary, Plate } from "../data/plates";
import { formatLatLon } from "../lib/geo";
import {
  DEPOSITS_WHY,
  PLATES_WHY,
  describeBoundary,
  describeGravity,
  describeMagnetic,
  formatDistance,
  formatValue,
  type Reading,
} from "./copy";
import { $, h } from "./dom";

export interface PointFacts {
  lat: number;
  lon: number;
  place: { label: string; distanceKm: number } | null;
  magnetic: { value: number; units: string } | null;
  gravity: { value: number; units: string } | null;
  plate: Plate | null;
  boundary: { boundary: Boundary; distanceKm: number } | null;
  deposits: { deposit: Deposit; distanceKm: number }[] | null;
  depositRadiusKm: number;
  picked: Deposit | null;
  /** Nearest depth stop, used to favour the layer the user is looking at. */
  depthStop: number;
}

function placeTitle(f: PointFacts): string {
  if (f.picked) return f.picked.name;
  if (!f.place) return "Remote area";
  if (f.place.distanceKm < 15) return f.place.label;
  return `${formatDistance(f.place.distanceKm)} from ${f.place.label}`;
}

function pickHeadline(f: PointFacts): { text: string; why: string[] } {
  const candidates: (Reading & { bias: number })[] = [];
  const mag = f.magnetic && Number.isFinite(f.magnetic.value) ? describeMagnetic(f.magnetic.value) : null;
  const grav = f.gravity && Number.isFinite(f.gravity.value) ? describeGravity(f.gravity.value) : null;
  const bnd = f.boundary ? describeBoundary(f.boundary.boundary.cls.label, f.boundary.distanceKm) : null;
  // The layer on screen wins unless another reading is far more remarkable.
  if (mag) candidates.push({ ...mag, bias: f.depthStop === 1 ? 0.5 : f.depthStop === 0 ? 0.1 : 0 });
  if (grav) candidates.push({ ...grav, bias: f.depthStop === 2 ? 0.5 : 0 });
  if (bnd) candidates.push({ ...bnd, bias: f.depthStop === 3 ? 0.5 : 0 });
  candidates.sort((a, b) => b.strength + b.bias - (a.strength + a.bias));

  const why: string[] = [];
  if (mag) why.push(mag.why);
  if (grav) why.push(grav.why);
  if (f.plate || f.boundary) why.push(PLATES_WHY);
  if (f.deposits?.length || f.picked) why.push(DEPOSITS_WHY);

  if (f.picked) {
    const d = f.picked;
    const what = d.commodities.length ? d.commodities.slice(0, 3).join(", ") : "minerals";
    return { text: `${statusLabel(d.status)} site for ${what}. ${candidates[0]?.headline ?? ""}`.trim(), why };
  }
  return { text: candidates[0]?.headline ?? "No data layers cover this point.", why };
}

function chips(d: Deposit) {
  return h(
    "div",
    { class: "chips" },
    d.commodities.slice(0, 6).map((c, i) =>
      h("span", i === 0 ? { class: "chip primary", style: `background:${d.group.colour}` } : { class: "chip" }, c),
    ),
  );
}

function depositItem(d: Deposit, distanceKm: number) {
  return h(
    "li",
    null,
    h("div", { class: "deposit-head" }, h("strong", null, d.name), h("span", null, formatDistance(distanceKm))),
    chips(d),
    h(
      "div",
      { class: "deposit-meta" },
      `${statusLabel(d.status)} · ${d.source.name}${d.source.legacy ? " (legacy data, not updated)" : ""}`,
    ),
  );
}

export function renderCard(f: PointFacts, onCopy: () => void) {
  const content = $("card-content");
  const headline = pickHeadline(f);
  const rows: HTMLElement[] = [];
  const row = (label: string, value: string, note?: string) =>
    rows.push(h("dt", null, label), h("dd", null, value, note ? h("small", null, note) : null));

  if (f.magnetic) row("Magnetic", formatValue(f.magnetic.value, f.magnetic.units));
  if (f.gravity) row("Gravity", formatValue(f.gravity.value, f.gravity.units, 1));
  if (f.plate) row("Plate", f.plate.name);
  if (f.boundary) {
    row(
      "Nearest boundary",
      formatDistance(f.boundary.distanceKm),
      f.boundary.boundary.cls.label,
    );
  }

  const depositsSection: (HTMLElement | null)[] = [];
  if (f.deposits) {
    depositsSection.push(h("h3", { class: "card-section-title" }, `Deposits within ${f.depositRadiusKm} km`));
    const list = f.picked
      ? [{ deposit: f.picked, distanceKm: 0 }, ...f.deposits.filter((x) => x.deposit !== f.picked)].slice(0, 5)
      : f.deposits;
    depositsSection.push(
      list.length
        ? h("ul", { class: "deposit-list" }, list.map((x) => depositItem(x.deposit, x.distanceKm)))
        : h("p", { class: "muted" }, "No recorded deposits nearby. Absence here often means no survey, not no minerals."),
    );
  }

  const copyButton = h("button", { class: "button primary", type: "button" }, "Copy link to this point");
  copyButton.addEventListener("click", async () => {
    onCopy();
    copyButton.textContent = "Link copied";
    setTimeout(() => (copyButton.textContent = "Copy link to this point"), 1600);
  });

  const parts: (HTMLElement | null)[] = [
    h("h2", { class: "card-place", id: "card-title" }, placeTitle(f)),
    h("p", { class: "card-coords" }, formatLatLon(f.lat, f.lon)),
    h("p", { class: "card-headline" }, headline.text),
    rows.length ? h("dl", { class: "card-rows" }, rows) : null,
    ...depositsSection,
    headline.why.length
      ? h("details", { class: "why" }, h("summary", null, "Why this matters"), headline.why.map((t) => h("p", null, t)))
      : null,
    h("div", { class: "card-actions" }, copyButton),
  ];
  content.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
}

export function renderCardLoading(lat: number, lon: number) {
  $("card-content").replaceChildren(
    h("h2", { class: "card-place" }, "Reading the data…"),
    h("p", { class: "card-coords" }, formatLatLon(lat, lon)),
  );
}

