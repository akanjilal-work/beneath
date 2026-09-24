import { BillboardCollection, Cartesian3, NearFarScalar, VerticalOrigin, type Scene } from "cesium";
import { LIVE_PROXY_URL } from "../config";
import { windyCamsFromFile, type Webcam, type WindyFile } from "../data/webcams";

/** Below this camera height, extra webcams near the view are loaded from Windy through the Worker. */
export const WEBCAM_MAX_VIEW_M = 1_200_000;
// Visible at every height, shrinking from space so clusters read as coverage rather than noise.
const SCALE = new NearFarScalar(2e4, 1.2, 2e7, 0.45);

/** A CCTV camera on a wall mount, in the given colour: green for traffic cameras, blue for webcams. */
export function cameraIcon(colour: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g stroke-linejoin="round" stroke-linecap="round">' +
    '<path d="M13 18v5H6" fill="none" stroke="#0b1220" stroke-width="4.5"/><path d="M13 18v5H6" fill="none" stroke="#fff" stroke-width="2"/>' +
    `<rect x="3" y="19" width="4" height="10" rx="1.2" fill="${colour}" stroke="#0b1220" stroke-width="1.5"/>` +
    `<g transform="rotate(20 15 11)"><rect x="3" y="6" width="20" height="10" rx="2.5" fill="${colour}" stroke="#0b1220" stroke-width="1.6"/>` +
    `<path d="M23 8.5l6-2v9l-6-2z" fill="${colour}" stroke="#0b1220" stroke-width="1.6"/><circle cx="8" cy="11" r="1.6" fill="#0b1220"/></g></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
export const TRAFFIC_ICON = cameraIcon("#34d399");
export const WEBCAM_ICON = cameraIcon("#60a5fa");

/** Rounded position key: two cameras within about 100 m count as the same camera. */
const spot = (lon: number, lat: number) => `${Math.round(lon * 1000)},${Math.round(lat * 1000)}`;

export class WebcamLayer {
  private readonly scene: Scene;
  private readonly points: BillboardCollection;
  private readonly nearby: BillboardCollection;
  private known = new Set<string>();
  private windyArea = "";
  private windyCount = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.points = scene.primitives.add(new BillboardCollection({ scene })) as BillboardCollection;
    this.nearby = scene.primitives.add(new BillboardCollection({ scene })) as BillboardCollection;
    this.points.show = false;
    this.nearby.show = false;
  }

  get nearbyCount() {
    return this.windyCount;
  }

  private addTo(collection: BillboardCollection, cam: Webcam, icon: string) {
    collection.add({
      position: Cartesian3.fromDegrees(cam.lon, cam.lat, 30),
      image: icon,
      width: 22,
      height: 22,
      verticalOrigin: VerticalOrigin.CENTER,
      scaleByDistance: SCALE,
      id: cam,
    });
  }

  /**
   * Windy webcams around a point, through the Worker. Cameras already in the traffic snapshot are
   * skipped (Windy republishes many of them). Returns the number added, or null when unavailable.
   */
  async loadNearby(lat: number, lon: number, radiusKm: number): Promise<number | null> {
    if (!LIVE_PROXY_URL) return null;
    const url = new URL("webcams", LIVE_PROXY_URL.endsWith("/") ? LIVE_PROXY_URL : `${LIVE_PROXY_URL}/`);
    // Same rounding as the Worker's cache, so small pans reuse the loaded cameras.
    const half = (v: number) => (Math.round(v * 2) / 2).toFixed(1);
    url.search = new URLSearchParams({ lat: half(lat), lon: half(lon), r: String(Math.ceil(radiusKm / 50) * 50) }).toString();
    const area = url.search;
    if (area === this.windyArea) return this.windyCount;
    const res = await fetch(url);
    if (!res.ok) return null;
    const cams = windyCamsFromFile((await res.json()) as WindyFile, 1_000_000).filter((c) => !this.known.has(spot(c.lon, c.lat)));
    this.windyArea = area;
    this.nearby.removeAll();
    for (const cam of cams) this.addTo(this.nearby, cam, WEBCAM_ICON);
    this.windyCount = cams.length;
    this.scene.requestRender();
    return cams.length;
  }

  setWebcams(cams: Webcam[]) {
    this.points.removeAll();
    this.known = new Set(cams.map((c) => spot(c.lon, c.lat)));
    for (const cam of cams) this.addTo(this.points, cam, cam.source.id === "windy" ? WEBCAM_ICON : TRAFFIC_ICON);
    this.scene.requestRender();
  }

  setVisible(show: boolean) {
    this.points.show = show;
    this.nearby.show = show;
    this.scene.requestRender();
  }
}
