import { BillboardCollection, Cartesian3, Color, NearFarScalar, type Billboard, type Scene } from "cesium";
import { LIVE_PROXY_URL } from "../config";
import { advance, aircraftFromFile, type Aircraft, type AircraftFile } from "../data/aircraft";

export const aircraftAvailable = Boolean(LIVE_PROXY_URL);

/** Above this camera height there are too many aircraft to draw usefully; the legend says zoom in. */
export const AIRCRAFT_MAX_VIEW_M = 1_500_000;
const POLL_MS = 10_000;
const MOVE_MS = 1_000;

// A plane pointing up (north); billboards rotate it to the aircraft's track.
const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2c1.2 0 2 1.3 2 3v7.5l11 6.5v3l-11-3.3V25l3.5 2.6V30L16 28.6 10.5 30v-2.4L14 25v-6.3L3 22v-3l11-6.5V5c0-1.7.8-3 2-3z" fill="#fff" stroke="#0b1220" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  );

async function fetchAircraft(lat: number, lon: number, radiusNm: number): Promise<{ planes: Aircraft[]; source: string }> {
  const url = new URL("aircraft", LIVE_PROXY_URL.endsWith("/") ? LIVE_PROXY_URL : `${LIVE_PROXY_URL}/`);
  url.search = new URLSearchParams({ lat: lat.toFixed(2), lon: lon.toFixed(2), r: String(Math.round(radiusNm)) }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Aircraft feed returned ${res.status}`);
  const file = (await res.json()) as AircraftFile;
  return { planes: aircraftFromFile(file), source: file.source };
}

export type AircraftStatus = { state: "off" } | { state: "zoom" } | { state: "ok"; count: number; source: string } | { state: "error" };

/**
 * Live aircraft around the view. Polls the Worker every 10 seconds while the camera is low enough,
 * and moves each aircraft along its track between polls.
 */
export class AircraftLayer {
  private readonly scene: Scene;
  private readonly billboards: BillboardCollection;
  private items = new Map<string, { plane: Aircraft; billboard: Billboard }>();
  private pollTimer = 0;
  private moveTimer = 0;
  private view: () => { lat: number; lon: number; heightM: number };
  private statusListener: (s: AircraftStatus) => void = () => {};

  constructor(scene: Scene, view: () => { lat: number; lon: number; heightM: number }) {
    this.scene = scene;
    this.view = view;
    this.billboards = scene.primitives.add(new BillboardCollection({ scene })) as BillboardCollection;
  }

  onStatus(fn: (s: AircraftStatus) => void) {
    this.statusListener = fn;
  }

  setVisible(show: boolean) {
    window.clearInterval(this.pollTimer);
    window.clearInterval(this.moveTimer);
    this.billboards.show = show;
    if (!show || !aircraftAvailable) {
      this.clear();
      this.statusListener({ state: "off" });
      return;
    }
    void this.poll();
    this.pollTimer = window.setInterval(() => void this.poll(), POLL_MS);
    this.moveTimer = window.setInterval(() => this.move(), MOVE_MS);
  }

  private clear() {
    this.billboards.removeAll();
    this.items.clear();
    this.scene.requestRender();
  }

  /** Poll now, for example after the camera moves to a new area. */
  refresh() {
    void this.poll();
  }

  private async poll() {
    const v = this.view();
    if (v.heightM > AIRCRAFT_MAX_VIEW_M) {
      this.clear();
      this.statusListener({ state: "zoom" });
      return;
    }
    const radiusNm = Math.min(250, Math.max(30, (v.heightM / 1000) * 0.9 / 1.852));
    let planes: Aircraft[];
    let source: string;
    try {
      ({ planes, source } = await fetchAircraft(v.lat, v.lon, radiusNm));
    } catch (err) {
      console.warn(err);
      this.statusListener({ state: "error" });
      return;
    }
    if (!this.billboards.show) return;
    const seen = new Set<string>();
    for (const plane of planes) {
      seen.add(plane.hex);
      const item = this.items.get(plane.hex);
      if (item) item.plane = plane;
      else {
        const billboard = this.billboards.add({
          position: Cartesian3.fromDegrees(plane.lon, plane.lat, plane.altM ?? 0),
          image: ICON,
          width: 20,
          height: 20,
          color: plane.altM === 0 ? Color.fromCssColorString("#9aa6bd") : Color.fromCssColorString("#ffd166"),
          scaleByDistance: new NearFarScalar(2e4, 1.4, 1.5e6, 0.6),
          alignedAxis: Cartesian3.UNIT_Z,
          id: plane,
        });
        this.items.set(plane.hex, { plane, billboard });
      }
    }
    for (const [hex, item] of this.items) {
      if (!seen.has(hex)) {
        this.billboards.remove(item.billboard);
        this.items.delete(hex);
      }
    }
    this.move();
    this.statusListener({ state: "ok", count: this.items.size, source });
  }

  private move() {
    const now = Date.now();
    for (const { plane, billboard } of this.items.values()) {
      const p = advance(plane, Math.min(60_000, now - plane.seen));
      billboard.position = Cartesian3.fromDegrees(p.lon, p.lat, plane.altM ?? 0);
      billboard.rotation = -((plane.track ?? 0) * Math.PI) / 180;
      billboard.id = plane;
    }
    this.scene.requestRender();
  }
}
