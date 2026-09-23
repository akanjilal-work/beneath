import { Cartesian3, Cartographic, Math as CesiumMath, Transforms, type Viewer } from "cesium";

/**
 * Surface view: a drone-style first-person camera near the ground. Drag to look around; keys or
 * the on-screen pad move over the land while holding a constant height above the terrain.
 * Cesium's own globe controls are switched off while it is active and restored on exit.
 */
export interface SurfaceView {
  readonly active: boolean;
  enter(lat: number, lon: number, groundHeight: number): void;
  exit(): void;
  /** Hold a movement key down (pad buttons use this too). */
  press(action: MoveAction, down: boolean): void;
  onChange(fn: (active: boolean) => void): void;
  onHeight(fn: (metresAboveGround: number) => void): void;
}

export type MoveAction = "forward" | "back" | "left" | "right" | "up" | "down" | "fast";

const KEYS: Record<string, MoveAction> = {
  w: "forward",
  arrowup: "forward",
  s: "back",
  arrowdown: "back",
  a: "left",
  arrowleft: "left",
  d: "right",
  arrowright: "right",
  e: "up",
  pageup: "up",
  q: "down",
  pagedown: "down",
  shift: "fast",
};

// Metres above ground on arrival. The imagery is 10 m per pixel, so much lower looks soft.
const START_HEIGHT = 500;
const MIN_HEIGHT = 2;
const MAX_HEIGHT = 20_000;
const LOOK_SPEED = 0.0035; // radians per pixel dragged

export function createSurfaceView(viewer: Viewer): SurfaceView {
  const { scene, camera } = viewer;
  const controller = scene.screenSpaceCameraController;
  const canvas = scene.canvas;
  const held = new Set<MoveAction>();
  const changeListeners: ((a: boolean) => void)[] = [];
  const heightListeners: ((h: number) => void)[] = [];
  let active = false;
  let agl = START_HEIGHT; // target height above ground
  let heading = 0;
  let pitch = CesiumMath.toRadians(-12);
  let dragging: { x: number; y: number; id: number } | null = null;
  let last = performance.now();
  let saved: Record<string, boolean> = {};

  // Height of loaded terrain under a point; undefined until its tile has loaded.
  const groundAt = (carto: Cartographic) => scene.globe.getHeight(carto);

  function applyOrientation() {
    camera.setView({ orientation: { heading, pitch, roll: 0 } });
    scene.requestRender();
  }

  function setControllerEnabled(on: boolean) {
    const flags = ["enableRotate", "enableTranslate", "enableZoom", "enableTilt", "enableLook"] as const;
    if (!on) {
      saved = Object.fromEntries(flags.map((f) => [f, controller[f]]));
      flags.forEach((f) => (controller[f] = false));
    } else {
      flags.forEach((f) => (controller[f] = saved[f] ?? true));
    }
  }

  function tick() {
    const now = performance.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (!active) return;
    const moving = ["forward", "back", "left", "right", "up", "down"].some((a) => held.has(a as MoveAction));
    if (!moving) return;

    // Speed scales with height so moving feels the same low and high.
    const speed = Math.max(12, agl * 0.9) * (held.has("fast") ? 4 : 1);
    if (held.has("up")) agl = Math.min(MAX_HEIGHT, agl * (1 + 1.2 * dt) + 4 * dt);
    if (held.has("down")) agl = Math.max(MIN_HEIGHT, agl / (1 + 1.2 * dt) - 4 * dt);

    const fwd = (held.has("forward") ? 1 : 0) - (held.has("back") ? 1 : 0);
    const side = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
    const pos = camera.positionWC.clone();
    if (fwd || side) {
      // Move along the ground plane (east-north-up at the camera), not along the view ray,
      // so looking down does not dive into the terrain.
      const enu = Transforms.eastNorthUpToFixedFrame(pos);
      // Matrix4 is column-major: column 0 is east, column 1 is north.
      const east = new Cartesian3(enu[0], enu[1], enu[2]);
      const north = new Cartesian3(enu[4], enu[5], enu[6]);
      const dirX = Math.sin(heading) * fwd + Math.cos(heading) * side;
      const dirY = Math.cos(heading) * fwd - Math.sin(heading) * side;
      const step = Cartesian3.add(
        Cartesian3.multiplyByScalar(east, dirX * speed * dt, new Cartesian3()),
        Cartesian3.multiplyByScalar(north, dirY * speed * dt, new Cartesian3()),
        new Cartesian3(),
      );
      Cartesian3.add(pos, step, pos);
    }
    // Follow the terrain at the target height. Where terrain has not loaded yet, keep the
    // current height rather than assuming sea level and dropping into a mountain.
    const carto = Cartographic.fromCartesian(pos);
    const ground = groundAt(carto);
    const before = carto.height;
    carto.height = ground === undefined ? before + (held.has("up") ? agl * dt : 0) : ground + agl;
    camera.setView({
      destination: Cartographic.toCartesian(carto),
      orientation: { heading, pitch, roll: 0 },
    });
    heightListeners.forEach((fn) => fn(agl));
    scene.requestRender();
  }
  scene.preRender.addEventListener(tick);
  scene.postRender.addEventListener(() => {
    if (active && held.size) scene.requestRender();
  });

  // --- look around by dragging ---------------------------------------------------------
  canvas.addEventListener("pointerdown", (e) => {
    if (!active || dragging) return;
    dragging = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!active || !dragging || e.pointerId !== dragging.id) return;
    heading += (e.clientX - dragging.x) * LOOK_SPEED;
    pitch = CesiumMath.clamp(pitch - (e.clientY - dragging.y) * LOOK_SPEED, CesiumMath.toRadians(-89), CesiumMath.toRadians(35));
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    applyOrientation();
  });
  const endDrag = (e: PointerEvent) => {
    if (dragging && e.pointerId === dragging.id) dragging = null;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!active) return;
      e.preventDefault();
      agl = CesiumMath.clamp(agl * Math.pow(1.0015, e.deltaY), MIN_HEIGHT, MAX_HEIGHT);
      held.add("up"); // nudge one frame so the height applies immediately
      tick();
      held.delete("up");
    },
    { passive: false },
  );

  // --- keyboard ------------------------------------------------------------------------
  window.addEventListener("keydown", (e) => {
    if (!active || (e.target as HTMLElement).closest("input, select, textarea")) return;
    const action = KEYS[e.key.toLowerCase()];
    if (action) {
      held.add(action);
      last = performance.now();
      scene.requestRender();
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    const action = KEYS[e.key.toLowerCase()];
    if (action) held.delete(action);
  });
  window.addEventListener("blur", () => held.clear());

  const api: SurfaceView = {
    get active() {
      return active;
    },
    enter(lat, lon, groundHeight) {
      agl = START_HEIGHT;
      heading = 0;
      pitch = CesiumMath.toRadians(-18);
      held.clear();
      // Arrive a little south of the point, looking north at it.
      const back = (START_HEIGHT * 3) / 111_320;
      camera.flyTo({
        destination: Cartesian3.fromDegrees(lon, lat - back, groundHeight + START_HEIGHT),
        orientation: { heading, pitch, roll: 0 },
        duration: 3,
        complete: () => {
          heightListeners.forEach((fn) => fn(agl));
        },
      });
      if (!active) {
        active = true;
        setControllerEnabled(false);
        // Hide anything below the ground (deposits and lines are stored at sea level until lifted).
        scene.globe.depthTestAgainstTerrain = true;
        changeListeners.forEach((fn) => fn(true));
      }
    },
    exit() {
      if (!active) return;
      active = false;
      held.clear();
      dragging = null;
      setControllerEnabled(true);
      // From above, overlays at sea level should stay visible over high ground.
      scene.globe.depthTestAgainstTerrain = false;
      const c = camera.positionCartographic;
      camera.flyTo({
        destination: Cartesian3.fromRadians(c.longitude, c.latitude, 60_000),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
        duration: 2,
      });
      changeListeners.forEach((fn) => fn(false));
    },
    press(action, down) {
      if (down) {
        held.add(action);
        last = performance.now();
        scene.requestRender();
      } else held.delete(action);
    },
    onChange: (fn) => changeListeners.push(fn),
    onHeight: (fn) => heightListeners.push(fn),
  };
  return api;
}
