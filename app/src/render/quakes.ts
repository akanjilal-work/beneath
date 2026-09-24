import { Cartesian3, Color, NearFarScalar, PointPrimitiveCollection, type PointPrimitive, type Scene } from "cesium";
import { depthColour, magnitudePixels, type Quake } from "../data/quakes";

// Points grow as the camera comes closer, so a regional view reads as clearly as the whole planet.
// From space 90,000 points would bury the map, so they shrink and thin out with distance.
const SCALE = new NearFarScalar(5e5, 1.6, 2.2e7, 0.55);
const FADE = new NearFarScalar(3e6, 1, 2.2e7, 0.6);

/**
 * Earthquake hypocentres. On the surface by default; in see-beneath mode each point drops to the
 * depth where the rupture started, so subducting slabs appear as sheets of points inside the Earth.
 */
export class QuakeLayer {
  private readonly scene: Scene;
  private readonly collection: PointPrimitiveCollection;
  private readonly items: { quake: Quake; point: PointPrimitive }[] = [];
  private deep = false;

  constructor(scene: Scene) {
    this.scene = scene;
    this.collection = scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
    this.collection.show = false;
  }

  private position(q: Quake): Cartesian3 {
    return Cartesian3.fromDegrees(q.lon, q.lat, this.deep ? -q.depthKm * 1000 : 0);
  }

  add(quakes: Quake[]) {
    // Smallest first so the rare large events draw over the crowd.
    for (const quake of [...quakes].sort((a, b) => a.mag - b.mag)) {
      const point = this.collection.add({
        position: this.position(quake),
        color: Color.fromCssColorString(depthColour(quake.depthKm)).withAlpha(quake.recent ? 1 : 0.8),
        pixelSize: magnitudePixels(quake.mag) + (quake.recent ? 2 : 0),
        outlineColor: Color.WHITE,
        outlineWidth: quake.recent ? 2 : 0,
        scaleByDistance: SCALE,
        translucencyByDistance: quake.recent ? undefined : FADE,
        id: quake,
      });
      this.items.push({ quake, point });
    }
    this.scene.requestRender();
  }

  setDeep(deep: boolean) {
    if (deep === this.deep) return;
    this.deep = deep;
    for (const { quake, point } of this.items) point.position = this.position(quake);
    this.scene.requestRender();
  }

  setVisible(show: boolean) {
    this.collection.show = show;
    this.scene.requestRender();
  }
}
