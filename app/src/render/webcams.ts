import { Cartesian3, Color, DistanceDisplayCondition, NearFarScalar, PointPrimitiveCollection, type Scene } from "cesium";
import { LIVE_PROXY_URL } from "../config";
import { windyCamsFromFile, type Webcam, type WindyFile } from "../data/webcams";

/** Cameras appear once the view is regional; thousands of dots from space would be noise. */
export const WEBCAM_MAX_VIEW_M = 1_200_000;
const SHOW = new DistanceDisplayCondition(0, WEBCAM_MAX_VIEW_M);
const SCALE = new NearFarScalar(2e4, 1.5, 1.2e6, 0.8);

const TRAFFIC = Color.fromCssColorString("#34d399");
const WINDY = Color.fromCssColorString("#60a5fa");

/** Rounded position key: two cameras within about 100 m count as the same camera. */
const spot = (lon: number, lat: number) => `${Math.round(lon * 1000)},${Math.round(lat * 1000)}`;

export class WebcamLayer {
  private readonly scene: Scene;
  private readonly points: PointPrimitiveCollection;
  private readonly nearby: PointPrimitiveCollection;
  private known = new Set<string>();
  private windyArea = "";
  private windyCount = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.points = scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
    this.nearby = scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
    this.points.show = false;
    this.nearby.show = false;
  }

  get nearbyCount() {
    return this.windyCount;
  }

  private addTo(collection: PointPrimitiveCollection, cam: Webcam, colour: Color) {
    collection.add({
      position: Cartesian3.fromDegrees(cam.lon, cam.lat, 30),
      color: colour,
      pixelSize: 7,
      outlineColor: Color.WHITE,
      outlineWidth: 1.5,
      scaleByDistance: SCALE,
      distanceDisplayCondition: SHOW,
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
    for (const cam of cams) this.addTo(this.nearby, cam, WINDY);
    this.windyCount = cams.length;
    this.scene.requestRender();
    return cams.length;
  }

  setWebcams(cams: Webcam[]) {
    this.points.removeAll();
    this.known = new Set(cams.map((c) => spot(c.lon, c.lat)));
    for (const cam of cams) this.addTo(this.points, cam, TRAFFIC);
    this.scene.requestRender();
  }

  setVisible(show: boolean) {
    this.points.show = show;
    this.nearby.show = show;
    this.scene.requestRender();
  }
}
