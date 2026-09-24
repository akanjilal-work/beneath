import { statusLabel, type Deposit } from "../data/deposits";
import { formatDate, type NearbySummary, type Quake } from "../data/quakes";
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
  quakes: NearbySummary | null;
  quakeRadiusKm: number;
  picked: Deposit | null;
  pickedQuake: Quake | null;
  /** Nearest depth stop, used to favour the layer the user is looking at. */
  depthStop: number;
}

const QUAKES_WHY =
  "Earthquakes mark where plates grind past, pull apart or sink. Their depth traces a sinking plate: at a subduction zone, earthquakes get deeper the further they are from the trench.";

/** Plain-language reading of a hypocentre depth. */
function depthNote(depthKm: number): string {
  if (depthKm < 70) return "Shallow: it broke the brittle crust or upper plate.";
  if (depthKm < 300) return "Intermediate depth: inside a plate that is sinking into the mantle.";
  return "Deep focus: hundreds of kilometres down inside a sinking plate, where rock should be too hot to snap. How these earthquakes happen is still debated.";
}

function placeTitle(f: PointFacts): string {
  if (f.pickedQuake) return f.pickedQuake.name ?? `Magnitude ${f.pickedQuake.mag.toFixed(1)} earthquake`;
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
  if (f.quakes?.count || f.pickedQuake) why.push(QUAKES_WHY);

  if (f.pickedQuake) {
    const q = f.pickedQuake;
    const when = q.recent ? `${new Date(q.time).toISOString().slice(0, 16).replace("T", " ")} UTC` : formatDate(q.time);
    return { text: `Magnitude ${q.mag.toFixed(1)} on ${when}, ${Math.round(q.depthKm)} km below the surface. ${depthNote(q.depthKm)}`, why };
  }

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

export interface CardActions {
  onCopy: () => void;
  /** Fly down to ground level at a point. */
  onSurface: (lat: number, lon: number) => void;
  /** Start drawing a cross-section from this point. */
  onSection: (lat: number, lon: number) => void;
}

function depositItem(d: Deposit, distanceKm: number, actions: CardActions) {
  const visit = h("button", { class: "link-button", type: "button" }, "Visit site");
  visit.addEventListener("click", () => actions.onSurface(d.lat, d.lon));
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
    visit,
  );
}

export function renderCard(f: PointFacts, actions: CardActions) {
  const content = $("card-content");
  const headline = pickHeadline(f);
  const rows: HTMLElement[] = [];
  const row = (label: string, value: string, note?: string) =>
    rows.push(h("dt", null, label), h("dd", null, value, note ? h("small", null, note) : null));

  if (f.magnetic) row("Magnetic", formatValue(f.magnetic.value, f.magnetic.units));
  if (f.gravity) row("Gravity", formatValue(f.gravity.value, f.gravity.units, 1));
  if (f.plate) row("Plate", f.plate.name);
  if (f.quakes) {
    const q = f.quakes;
    row(
      `Earthquakes within ${f.quakeRadiusKm} km`,
      q.count ? `${q.count.toLocaleString()} since 1970` : "None recorded",
      q.count
        ? [
            q.largest ? `largest M${q.largest.mag.toFixed(1)} (${formatDate(q.largest.time).slice(0, 4)})` : "",
            q.deepest && q.deepest.depthKm >= 70 ? `deepest ${Math.round(q.deepest.depthKm)} km` : "",
            q.recent ? `${q.recent} in the past week` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "M5+ since 1970",
    );
  }
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
        ? h("ul", { class: "deposit-list" }, list.map((x) => depositItem(x.deposit, x.distanceKm, actions)))
        : h("p", { class: "muted" }, "No recorded deposits nearby. Absence here often means no survey, not no minerals."),
    );
  }

  const surfaceButton = h("button", { class: "button primary", type: "button" }, "Go to the surface");
  surfaceButton.addEventListener("click", () => actions.onSurface(f.lat, f.lon));
  const sectionButton = h("button", { class: "button", type: "button" }, "Section from here");
  sectionButton.addEventListener("click", () => actions.onSection(f.lat, f.lon));
  const copyButton = h("button", { class: "button", type: "button" }, "Copy link");
  copyButton.addEventListener("click", async () => {
    actions.onCopy();
    copyButton.textContent = "Link copied";
    setTimeout(() => (copyButton.textContent = "Copy link"), 1600);
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
    h("div", { class: "card-actions" }, surfaceButton, sectionButton, copyButton),
  ];
  content.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
}

export function renderCardLoading(lat: number, lon: number) {
  $("card-content").replaceChildren(
    h("h2", { class: "card-place" }, "Reading the data…"),
    h("p", { class: "card-coords" }, formatLatLon(lat, lon)),
  );
}


export interface InfoCard {
  title: string;
  subtitle: string;
  headline?: string;
  rows?: [string, string, string?][];
  /** A live image, reloaded every refreshMs while the card is open. */
  image?: { src: () => string; alt: string; refreshMs: number };
  links?: { label: string; href: string }[];
  actions?: { label: string; primary?: boolean; onClick: () => void }[];
  note?: string;
}

let imageTimer = 0;

/** A card for something above the surface: a satellite, an aircraft or a camera. */
export function renderInfoCard(card: InfoCard) {
  window.clearInterval(imageTimer);
  const rows: HTMLElement[] = [];
  for (const [label, value, note] of card.rows ?? []) rows.push(h("dt", null, label), h("dd", null, value, note ? h("small", null, note) : null));
  let img: HTMLImageElement | null = null;
  if (card.image) {
    const image = card.image;
    img = h("img", { class: "card-image", src: image.src(), alt: image.alt, loading: "eager", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img!.replaceWith(h("p", { class: "muted" }, "The camera image is not available right now.")));
    imageTimer = window.setInterval(() => {
      if (!img?.isConnected) return window.clearInterval(imageTimer);
      img.src = image.src();
    }, image.refreshMs);
  }
  const actions = (card.actions ?? []).map((a) => {
    const b = h("button", { class: a.primary ? "button primary" : "button", type: "button" }, a.label);
    b.addEventListener("click", a.onClick);
    return b;
  });
  const parts: (HTMLElement | null)[] = [
    h("h2", { class: "card-place", id: "card-title" }, card.title),
    h("p", { class: "card-coords" }, card.subtitle),
    img,
    card.headline ? h("p", { class: "card-headline" }, card.headline) : null,
    rows.length ? h("dl", { class: "card-rows" }, rows) : null,
    card.note ? h("p", { class: "muted card-note" }, card.note) : null,
    card.links?.length
      ? h("p", { class: "card-links" }, card.links.map((l) => h("a", { href: l.href, target: "_blank", rel: "noopener" }, l.label)))
      : null,
    actions.length ? h("div", { class: "card-actions" }, actions) : null,
  ];
  $("card-content").replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
}

export function stopCardImage() {
  window.clearInterval(imageTimer);
}
