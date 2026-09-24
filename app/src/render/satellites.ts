import {
  Cartesian3,
  Color,
  Material,
  NearFarScalar,
  PointPrimitiveCollection,
  PolylineCollection,
  type PointPrimitive,
  type Polyline,
  type Scene,
} from "cesium";
import { gstime } from "satellite.js";
import { ORBIT_CLASSES, orbitPath, positionAt, type OrbitClass, type Satellite } from "../data/satellites";

const COLOURS = Object.fromEntries(ORBIT_CLASSES.map((c) => [c.id, Color.fromCssColorString(c.colour)])) as Record<OrbitClass, Color>;
const SIZE: Record<OrbitClass, number> = { station: 8, starlink: 2, leo: 3, meo: 4, geo: 4, heo: 4 };
const SCALE = new NearFarScalar(1e6, 1.4, 6e7, 0.7);
/** Update this many satellites per step; a full pass over 16,000 takes about 2 seconds. */
const SLICE = 2000;
const STEP_MS = 250;

/** Active satellites, moving live. Positions come from SGP4 in slices so frames never stall. */
export class SatelliteLayer {
  private readonly scene: Scene;
  private readonly points: PointPrimitiveCollection;
  private readonly orbits: PolylineCollection;
  private items: { sat: Satellite; point: PointPrimitive }[] = [];
  private cursor = 0;
  private timer = 0;
  private orbit: Polyline | null = null;
  private selected: Satellite | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.points = scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
    this.orbits = scene.primitives.add(new PolylineCollection()) as PolylineCollection;
    this.points.show = false;
  }

  get count() {
    return this.items.length;
  }

  setSatellites(sats: Satellite[]) {
    this.points.removeAll();
    this.items = sats.map((sat) => ({
      sat,
      point: this.points.add({
        position: Cartesian3.ZERO,
        show: false,
        color: COLOURS[sat.cls],
        pixelSize: SIZE[sat.cls],
        outlineColor: Color.BLACK.withAlpha(0.5),
        outlineWidth: sat.cls === "station" ? 2 : 0,
        scaleByDistance: SCALE,
        id: sat,
      }),
    }));
    this.cursor = 0;
    // Place everything once, then keep them moving in slices.
    this.update(this.items.length);
  }

  private update(count: number) {
    if (!this.items.length) return;
    const now = new Date();
    const gmst = gstime(now);
    for (let i = 0; i < count; i++) {
      const item = this.items[this.cursor];
      this.cursor = (this.cursor + 1) % this.items.length;
      const p = positionAt(item.sat, now, gmst);
      item.point.show = p !== null;
      if (p) item.point.position = new Cartesian3(p.ecf.x * 1000, p.ecf.y * 1000, p.ecf.z * 1000);
    }
    this.scene.requestRender();
  }

  setVisible(show: boolean) {
    this.points.show = show;
    this.orbits.show = show;
    window.clearInterval(this.timer);
    if (show) {
      this.update(this.items.length);
      this.timer = window.setInterval(() => this.update(SLICE), STEP_MS);
    }
    this.scene.requestRender();
  }

  /** Draw one orbit of a satellite as a loop, or clear it. */
  select(sat: Satellite | null) {
    this.selected = sat;
    if (this.orbit) this.orbits.remove(this.orbit);
    this.orbit = null;
    if (sat) {
      const path = orbitPath(sat, new Date()).map((p) => new Cartesian3(p.x * 1000, p.y * 1000, p.z * 1000));
      this.orbit = this.orbits.add({
        positions: path,
        width: 1.5,
        material: Material.fromType("Color", { color: COLOURS[sat.cls].withAlpha(0.8) }),
      });
    }
    this.scene.requestRender();
  }

  get selection() {
    return this.selected;
  }
}
