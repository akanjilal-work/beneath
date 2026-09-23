// A single small store, serialised to and from the URL hash so any view can be shared.
// Example: #lat=43.55&lon=-80.25&alt=900000&d=1&layers=deposits,boundaries&ramp=diverging&pick=43.55,-80.25

import type { RampId } from "./lib/ramps";

export type OverlayId = "deposits" | "boundaries" | "coastlines" | "live";
export const OVERLAYS: OverlayId[] = ["deposits", "boundaries", "coastlines", "live"];

export interface AppState {
  lat: number;
  lon: number;
  alt: number;
  /** Depth slider position: 0 surface, 1 magnetic, 2 gravity, 3 plates. */
  depth: number;
  overlays: Set<OverlayId>;
  ramp: RampId;
  relief: boolean;
  mode: "3d" | "2d";
  theme: "dark" | "light";
  pick: { lat: number; lon: number } | null;
}

export const DEPTH_STOPS = ["Surface", "Magnetic", "Gravity", "Plates"] as const;
export const MAX_DEPTH = DEPTH_STOPS.length - 1;

const DEFAULTS: AppState = {
  lat: 20,
  lon: -40,
  alt: 20_000_000,
  depth: 1,
  overlays: new Set<OverlayId>(["boundaries", "coastlines", "live"]),
  ramp: "diverging",
  relief: true,
  mode: "3d",
  theme: "dark",
  pick: null,
};

// Older links used layers=mag / grav / plates for the raster; map them to a depth stop.
const LEGACY_LAYER_DEPTH: Record<string, number> = { mag: 1, magnetic: 1, grav: 2, gravity: 2, plates: 3 };

function num(v: string | null, min: number, max: number): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

export function parseHash(hash: string): { state: AppState; hadView: boolean } {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const s: AppState = { ...DEFAULTS, overlays: new Set(DEFAULTS.overlays) };
  const lat = num(p.get("lat"), -90, 90);
  const lon = num(p.get("lon"), -180, 180);
  const alt = num(p.get("alt"), 50, 60_000_000);
  if (lat !== null) s.lat = lat;
  if (lon !== null) s.lon = lon;
  if (alt !== null) s.alt = alt;
  const d = num(p.get("d"), 0, MAX_DEPTH);
  if (d !== null) s.depth = d;
  const layers = p.get("layers");
  if (layers !== null) {
    s.overlays = new Set();
    for (const l of layers.split(",").filter(Boolean)) {
      if ((OVERLAYS as string[]).includes(l)) s.overlays.add(l as OverlayId);
      else if (l in LEGACY_LAYER_DEPTH && d === null) s.depth = LEGACY_LAYER_DEPTH[l];
    }
  }
  const ramp = p.get("ramp");
  if (ramp === "diverging" || ramp === "sequential") s.ramp = ramp;
  if (p.get("relief") === "0") s.relief = false;
  if (p.get("mode") === "2d") s.mode = "2d";
  const theme = p.get("theme");
  if (theme === "light" || theme === "dark") s.theme = theme;
  const pick = p.get("pick");
  if (pick) {
    const [a, b] = pick.split(",").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) s.pick = { lat: a, lon: b };
  }
  return { state: s, hadView: lat !== null && lon !== null };
}

export function toHash(s: AppState): string {
  const parts = [
    `lat=${s.lat.toFixed(4)}`,
    `lon=${s.lon.toFixed(4)}`,
    `alt=${Math.round(s.alt)}`,
    `d=${Number(s.depth.toFixed(2))}`,
    `layers=${OVERLAYS.filter((o) => s.overlays.has(o)).join(",")}`,
    `ramp=${s.ramp}`,
  ];
  if (!s.relief) parts.push("relief=0");
  if (s.mode === "2d") parts.push("mode=2d");
  if (s.theme === "light") parts.push("theme=light");
  if (s.pick) parts.push(`pick=${s.pick.lat.toFixed(4)},${s.pick.lon.toFixed(4)}`);
  return `#${parts.join("&")}`;
}

type Listener = (s: AppState, changed: Set<keyof AppState>) => void;

export class Store {
  state: AppState;
  private listeners: Listener[] = [];
  private writeTimer = 0;

  constructor(initial: AppState) {
    this.state = initial;
  }

  subscribe(fn: Listener) {
    this.listeners.push(fn);
  }

  set(patch: Partial<AppState>) {
    const changed = new Set<keyof AppState>();
    for (const k of Object.keys(patch) as (keyof AppState)[]) {
      if (patch[k] !== this.state[k]) changed.add(k);
    }
    if (!changed.size) return;
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state, changed);
    this.scheduleWrite();
  }

  toggleOverlay(id: OverlayId, on?: boolean) {
    const overlays = new Set(this.state.overlays);
    const enable = on ?? !overlays.has(id);
    if (enable) overlays.add(id);
    else overlays.delete(id);
    this.set({ overlays });
  }

  private scheduleWrite() {
    window.clearTimeout(this.writeTimer);
    this.writeTimer = window.setTimeout(() => {
      history.replaceState(null, "", toHash(this.state));
    }, 250);
  }

  shareUrl(): string {
    return `${location.origin}${location.pathname}${toHash(this.state)}`;
  }
}
