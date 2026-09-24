import { Cartesian3, Color, DistanceDisplayCondition, NearFarScalar, PointPrimitiveCollection, type Scene } from "cesium";
import type { Webcam } from "../data/webcams";

/** Cameras appear once the view is regional; thousands of dots from space would be noise. */
export const WEBCAM_MAX_VIEW_M = 1_200_000;
const SHOW = new DistanceDisplayCondition(0, WEBCAM_MAX_VIEW_M);
const SCALE = new NearFarScalar(2e4, 1.5, 1.2e6, 0.8);

export class WebcamLayer {
  private readonly scene: Scene;
  private readonly points: PointPrimitiveCollection;

  constructor(scene: Scene) {
    this.scene = scene;
    this.points = scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
    this.points.show = false;
  }

  setWebcams(cams: Webcam[]) {
    this.points.removeAll();
    const colour = Color.fromCssColorString("#34d399");
    for (const cam of cams) {
      this.points.add({
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
    this.scene.requestRender();
  }

  setVisible(show: boolean) {
    this.points.show = show;
    this.scene.requestRender();
  }
}
