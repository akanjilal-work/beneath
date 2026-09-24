import {
  ArcType,
  buildModuleUrl,
  Cartesian2,
  CallbackProperty,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  Credit,
  DistanceDisplayCondition,
  GeometryInstance,
  HorizontalOrigin,
  ImageryLayer,
  Ion,
  LabelCollection,
  LabelStyle,
  Math as CesiumMath,
  NearFarScalar,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  PolylineColorAppearance,
  PolylineGeometry,
  Primitive,
  Rectangle,
  SceneMode,
  SingleTileImageryProvider,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
  WallGeometry,
  sampleTerrain,
  type PointPrimitive,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { IMAGERY_CREDIT, IMAGERY_MAX_LEVEL, IMAGERY_URL, US_IMAGERY_BOXES, US_IMAGERY_CREDIT, US_IMAGERY_MAX_LEVEL, US_IMAGERY_URL } from "../config";
import type { Deposit } from "../data/deposits";
import type { PlateModel } from "../data/plates";
import type { Quake } from "../data/quakes";

/** Things above the surface that open their own card when clicked. */
export type LiveObject = { kind: "satellite" | "aircraft" | "webcam" };
const isLive = (id: unknown): id is LiveObject =>
  typeof id === "object" && id !== null && ["satellite", "aircraft", "webcam"].includes((id as LiveObject).kind);
import { NoDataImageryProvider } from "./noDataImagery";
import { createTerrainProvider } from "./terrain";

// No Cesium ion: base imagery is the Natural Earth II tiles shipped inside the Cesium package.
Ion.defaultAccessToken = "";

export interface Globe {
  viewer: Viewer;
  onPick(fn: (lon: number, lat: number, deposit: Deposit | null, quake: Quake | null) => void): void;
  /** A satellite, aircraft or webcam was clicked. */
  onPickLive(fn: (obj: LiveObject) => void): void;
  /** Called with the ground point under the cursor while set; used to preview a section line. */
  setHover(fn: ((lon: number, lat: number) => void) | null): void;
  onInteract(fn: () => void): void;
  onCameraIdle(fn: (lat: number, lon: number, alt: number) => void): void;
  flyTo(lat: number, lon: number, alt?: number, duration?: number): void;
  setView(lat: number, lon: number, alt: number): void;
  addValueLayer(layer: ImageryLayer): void;
  setBoundaries(model: PlateModel, emphasis: number): void;
  setBoundaryVisible(show: boolean): void;
  setBoundaryEmphasis(emphasis: number): void;
  setPlateFill(model: PlateModel, alpha: number): Promise<void>;
  setDeposits(deposits: Deposit[]): void;
  setDepositsVisible(show: boolean): void;
  setCoastlines(lines: number[][][]): void;
  setCoastlinesVisible(show: boolean): void;
  setPickMarker(lat: number, lon: number): void;
  clearPickMarker(): void;
  setMode(mode: "3d" | "2d"): void;
  /** See beneath: make the surface translucent so points below it show at their true depth. */
  setXray(on: boolean): void;
  /** Draw a cross-section line with a curtain down to depthKm, or remove it (null). */
  setSection(points: { lat: number; lon: number }[] | null, depthKm?: number): void;
  /** Preview line while drawing a section (null to clear). */
  setSectionPreview(a: { lat: number; lon: number } | null, b?: { lat: number; lon: number }): void;
  setAutoRotate(on: boolean): void;
  setTheme(theme: "dark" | "light"): void;
  /** Ground height in metres at a point, sampled from the terrain (0 if unavailable). */
  groundHeight(lat: number, lon: number): Promise<number>;
}

/** Stable, distinct hue per plate (golden-ratio spacing). */
export function plateColour(i: number): string {
  const hue = Math.round(((i * 0.618034) % 1) * 360);
  return `hsl(${hue} 55% 58%)`;
}

/** Rasterise plate polygons to an equirectangular image; robust across the antimeridian and poles. */
function renderPlateCanvas(model: PlateModel): string {
  const w = 4096;
  const h = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const px = (lon: number) => ((lon + 180) / 360) * w;
  const py = (lat: number) => ((90 - lat) / 180) * h;
  model.plates.forEach((p, i) => {
    ctx.fillStyle = plateColour(i);
    for (const shift of [-360, 0, 360]) {
      ctx.beginPath();
      for (const poly of p.polygons) {
        for (const ring of poly) {
          ring.forEach(([x, y], k) => (k ? ctx.lineTo(px(x + shift), py(y)) : ctx.moveTo(px(x + shift), py(y))));
          ctx.closePath();
        }
      }
      ctx.fill("evenodd");
    }
  });
  return canvas.toDataURL("image/png");
}

const STATUS_SIZE = [7, 6, 5, 4]; // producer, past producer, prospect, occurrence
// Camera distance (m) below which each status appears. 200k points at once is noise, so
// producers show from space and smaller sites fade in as you zoom. Industrial minerals
// (sand, gravel, stone) are the most numerous, so they wait until you are closer still.
const STATUS_MAX_DISTANCE = [8_000_000, 1_200_000, 600_000, 400_000];

function depositMaxDistance(d: Deposit): number {
  const base = STATUS_MAX_DISTANCE[d.statusIndex] ?? 400_000;
  return d.group.key === "industrial" ? base * 0.25 : base;
}

export async function createGlobe(container: HTMLElement, creditContainer: HTMLElement): Promise<Globe> {
  const baseProvider = await TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII"));
  const viewer = new Viewer(container, {
    // Darkened to match Sentinel-2's oceans: it shows alone only around the poles (beyond the
    // 85 degree reach of the Mercator imagery) and while tiles load.
    baseLayer: new ImageryLayer(baseProvider, { brightness: 0.62, contrast: 1.1, saturation: 0.85 }),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    creditContainer,
    terrainProvider: createTerrainProvider(),
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });
  const { scene, camera } = viewer;
  scene.globe.baseColor = Color.fromCssColorString("#0b1220");
  scene.globe.showGroundAtmosphere = true;
  scene.globe.enableLighting = false;
  // Fog hides distant terrain tiles near the horizon, which matters in the surface view.
  scene.fog.enabled = true;
  // Ask for finer tiles than the default (2): the data layers are the point of the app.
  // Lower values sharpen further but slow the first load on phones.
  scene.globe.maximumScreenSpaceError = 1;
  // Close enough to stand on the ground; Cesium's collision detection keeps the camera above terrain.
  scene.screenSpaceCameraController.minimumZoomDistance = 30;

  // Satellite imagery over the bundled Natural Earth base, which stays underneath as an
  // instant, offline-safe fallback while tiles load.
  viewer.imageryLayers.addImageryProvider(
    new UrlTemplateImageryProvider({
      url: IMAGERY_URL,
      maximumLevel: IMAGERY_MAX_LEVEL,
      credit: new Credit(IMAGERY_CREDIT, false),
    }),
  );
  // About 1 m imagery over the US, for close-up views only. From regional heights Sentinel-2 alone
  // looks cleaner: the two sources photograph water in different tones, which reads as a patchwork.
  for (const [w, s, e, n] of US_IMAGERY_BOXES) {
    const provider = new NoDataImageryProvider({
      url: US_IMAGERY_URL,
      maximumLevel: US_IMAGERY_MAX_LEVEL,
      rectangle: Rectangle.fromDegrees(w, s, e, n),
      credit: new Credit(US_IMAGERY_CREDIT, false),
    });
    // Where the service has no data (Canada falls inside the boxes, and open water) its flat
    // fill is made transparent, so the global imagery shows through.
    viewer.imageryLayers.add(new ImageryLayer(provider, { minimumTerrainLevel: 13 }));
  }
  scene.screenSpaceCameraController.maximumZoomDistance = 40_000_000;
  viewer.cesiumWidget.creditContainer.classList.add("cesium-credits");

  // --- vector overlays -------------------------------------------------------------------
  let boundaryPrimitive: Primitive | null = null;
  let boundaryModel: PlateModel | null = null;
  let boundaryVisible = true;
  let boundaryEmphasis = 0;
  let plateLayer: ImageryLayer | null = null;
  let coastPrimitive: Primitive | null = null;
  const points = scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
  let depositPoints: { deposit: Deposit; point: PointPrimitive }[] = [];
  const lifted = new Set<number>();

  /**
   * Deposits are stored at sea level. Up close that buries them under hills, so when the camera
   * is low, sample the terrain under the deposits in view and lift them onto the ground.
   */
  async function liftDepositsInView() {
    if (!points.show || depositPoints.length === 0) return;
    if (camera.positionCartographic.height > 400_000) return;
    // Near the ground the view often includes sky, where Cesium cannot compute a view
    // rectangle; fall back to a box around the camera.
    const c = camera.positionCartographic;
    const pad = CesiumMath.toRadians(0.35);
    const rect = camera.computeViewRectangle() ?? {
      west: c.longitude - pad,
      east: c.longitude + pad,
      south: c.latitude - pad,
      north: c.latitude + pad,
    };
    const todo = depositPoints.filter(({ deposit: d }) => {
      if (lifted.has(d.index)) return false;
      const lon = CesiumMath.toRadians(d.lon);
      const lat = CesiumMath.toRadians(d.lat);
      const inLon = rect.west <= rect.east ? lon >= rect.west && lon <= rect.east : lon >= rect.west || lon <= rect.east;
      return inLon && lat >= rect.south && lat <= rect.north;
    });
    const batch = todo.slice(0, 3000);
    if (!batch.length) return;
    batch.forEach(({ deposit }) => lifted.add(deposit.index));
    const cartos = batch.map(({ deposit: d }) => Cartographic.fromDegrees(d.lon, d.lat));
    try {
      await sampleTerrain(viewer.terrainProvider, 12, cartos);
    } catch {
      return;
    }
    batch.forEach(({ deposit: d, point }, i) => {
      point.position = Cartesian3.fromDegrees(d.lon, d.lat, (cartos[i].height || 0) + 6);
    });
    scene.requestRender();
  }
  const pickMarker = scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;

  function lineInstances(lines: number[][][], colour: (i: number) => Color, width: number, ids?: unknown[]) {
    const instances: GeometryInstance[] = [];
    lines.forEach((line, i) => {
      if (line.length < 2) return;
      const positions = Cartesian3.fromDegreesArray(line.flatMap(([x, y]) => [x, y]));
      instances.push(
        new GeometryInstance({
          geometry: new PolylineGeometry({ positions, width, arcType: ArcType.GEODESIC, vertexFormat: PolylineColorAppearance.VERTEX_FORMAT }),
          attributes: { color: ColorGeometryInstanceAttribute.fromColor(colour(i)) },
          id: ids?.[i],
        }),
      );
    });
    return instances;
  }

  function buildBoundaries() {
    if (boundaryPrimitive) scene.primitives.remove(boundaryPrimitive);
    boundaryPrimitive = null;
    if (!boundaryModel) return;
    const lines: number[][][] = [];
    const colours: Color[] = [];
    for (const b of boundaryModel.boundaries) {
      for (const l of b.lines) {
        lines.push(l);
        colours.push(Color.fromCssColorString(b.cls.colour).withAlpha(0.55 + 0.45 * boundaryEmphasis));
      }
    }
    boundaryPrimitive = scene.primitives.add(
      new Primitive({
        geometryInstances: lineInstances(lines, (i) => colours[i], 1.5 + 2 * boundaryEmphasis),
        appearance: new PolylineColorAppearance({ translucent: true }),
        asynchronous: false,
        show: boundaryVisible,
      }),
    ) as Primitive;
    scene.requestRender();
  }

  // --- interaction ---------------------------------------------------------------------
  const handler = new ScreenSpaceEventHandler(scene.canvas);
  const pickListeners: ((lon: number, lat: number, d: Deposit | null, q: Quake | null) => void)[] = [];
  let hoverListener: ((lon: number, lat: number) => void) | null = null;
  const liveListeners: ((obj: LiveObject) => void)[] = [];
  const interactListeners: (() => void)[] = [];
  const idleListeners: ((lat: number, lon: number, alt: number) => void)[] = [];

  handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => {
    const picked = scene.pick(e.position);
    if (isLive(picked?.id)) {
      for (const fn of liveListeners) fn(picked.id);
      return;
    }
    let deposit: Deposit | null = null;
    let quake: Quake | null = null;
    if (picked?.primitive && (picked.primitive as PointPrimitive).id && picked.collection === points) {
      deposit = (picked.primitive as PointPrimitive).id as Deposit;
    } else if (picked?.id && typeof picked.id === "object" && "depthKm" in picked.id) {
      quake = picked.id as Quake;
    }
    let lon: number;
    let lat: number;
    if (deposit || quake) {
      lon = (deposit ?? quake)!.lon;
      lat = (deposit ?? quake)!.lat;
    } else {
      // Pick the terrain surface, not the ellipsoid, so tilted and ground-level views are exact.
      const ray = camera.getPickRay(e.position);
      const cart = (ray && scene.globe.pick(ray, scene)) ?? camera.pickEllipsoid(e.position, scene.globe.ellipsoid);
      if (!cart) return;
      const c = Cartographic.fromCartesian(cart);
      lon = CesiumMath.toDegrees(c.longitude);
      lat = CesiumMath.toDegrees(c.latitude);
    }
    for (const fn of pickListeners) fn(lon, lat, deposit, quake);
  }, ScreenSpaceEventType.LEFT_CLICK);

  // Pointer cursor over deposits.
  handler.setInputAction((e: ScreenSpaceEventHandler.MotionEvent) => {
    if (hoverListener) {
      const cart = camera.pickEllipsoid(e.endPosition, scene.globe.ellipsoid);
      if (cart) {
        const c = Cartographic.fromCartesian(cart);
        hoverListener(CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude));
      }
      scene.canvas.style.cursor = "crosshair";
      return;
    }
    const picked = scene.pick(e.endPosition);
    const pickable =
      picked?.collection === points || isLive(picked?.id) || (picked?.id && typeof picked.id === "object" && "depthKm" in picked.id);
    scene.canvas.style.cursor = pickable ? "pointer" : "";
  }, ScreenSpaceEventType.MOUSE_MOVE);

  // --- cross-section line, curtain and endpoint labels ---------------------------------
  let sectionLine: Primitive | null = null;
  let sectionWall: Primitive | null = null;
  const sectionLabels = scene.primitives.add(new LabelCollection()) as LabelCollection;
  let previewPositions: Cartesian3[] = [];
  const preview = viewer.entities.add({
    show: false,
    polyline: {
      positions: new CallbackProperty(() => previewPositions, false),
      width: 2,
      arcType: ArcType.GEODESIC,
      material: Color.fromCssColorString("#ffd166"),
    },
  });

  const notifyInteract = () => interactListeners.forEach((fn) => fn());
  for (const type of ["pointerdown", "wheel", "touchstart", "keydown"]) {
    scene.canvas.addEventListener(type, notifyInteract, { passive: true });
  }

  camera.moveEnd.addEventListener(() => {
    const c = camera.positionCartographic;
    const lat = CesiumMath.toDegrees(c.latitude);
    const lon = CesiumMath.toDegrees(c.longitude);
    idleListeners.forEach((fn) => fn(lat, lon, c.height));
    void liftDepositsInView();
  });

  // --- auto rotate ---------------------------------------------------------------------
  let rotating = false;
  let lastTick = performance.now();
  scene.preRender.addEventListener(() => {
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    if (rotating && scene.mode === SceneMode.SCENE3D) {
      camera.rotate(Cartesian3.UNIT_Z, -0.035 * Math.min(dt, 0.1));
      scene.requestRender();
    }
  });
  scene.postRender.addEventListener(() => {
    if (rotating) scene.requestRender();
  });

  const api: Globe = {
    viewer,
    onPick: (fn) => pickListeners.push(fn),
    onPickLive: (fn) => liveListeners.push(fn),
    onInteract: (fn) => interactListeners.push(fn),
    onCameraIdle: (fn) => idleListeners.push(fn),

    flyTo(lat, lon, alt, duration = 1.6) {
      const height = alt ?? Math.min(camera.positionCartographic.height, 2_500_000);
      camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, height), duration });
    },
    setView(lat, lon, alt) {
      camera.setView({ destination: Cartesian3.fromDegrees(lon, lat, alt) });
    },
    addValueLayer(layer) {
      viewer.imageryLayers.add(layer);
      scene.requestRender();
    },

    setBoundaries(model, emphasis) {
      boundaryModel = model;
      boundaryEmphasis = emphasis;
      buildBoundaries();
    },
    setBoundaryVisible(show) {
      boundaryVisible = show;
      if (boundaryPrimitive) boundaryPrimitive.show = show;
      scene.requestRender();
    },
    setBoundaryEmphasis(emphasis) {
      const e = Math.round(emphasis * 4) / 4;
      if (e === boundaryEmphasis) return;
      boundaryEmphasis = e;
      buildBoundaries();
    },

    async setPlateFill(model, alpha) {
      if (!plateLayer && alpha > 0.01) {
        const url = renderPlateCanvas(model);
        plateLayer = viewer.imageryLayers.addImageryProvider(await SingleTileImageryProvider.fromUrl(url));
      }
      if (plateLayer) {
        plateLayer.alpha = alpha;
        plateLayer.show = alpha > 0.01;
        // Keep plates above the value layers but below nothing else.
        viewer.imageryLayers.raiseToTop(plateLayer);
      }
      scene.requestRender();
    },

    setDeposits(deposits) {
      points.removeAll();
      depositPoints = [];
      lifted.clear();
      for (const d of deposits) {
        const size = STATUS_SIZE[d.statusIndex] ?? 4;
        const point = points.add({
          position: Cartesian3.fromDegrees(d.lon, d.lat),
          color: Color.fromCssColorString(d.group.colour),
          pixelSize: size,
          outlineColor: d.statusIndex === 0 ? Color.WHITE : Color.BLACK.withAlpha(0.6),
          outlineWidth: d.statusIndex === 0 ? 1.5 : 0.5,
          scaleByDistance: new NearFarScalar(3e5, 1.3, 2e7, 0.5),
          distanceDisplayCondition: new DistanceDisplayCondition(0, depositMaxDistance(d)),
          id: d,
        });
        depositPoints.push({ deposit: d, point });
      }
      scene.requestRender();
    },
    setDepositsVisible(show) {
      points.show = show;
      if (show) void liftDepositsInView();
      scene.requestRender();
    },

    setCoastlines(lines) {
      if (coastPrimitive) scene.primitives.remove(coastPrimitive);
      coastPrimitive = scene.primitives.add(
        new Primitive({
          geometryInstances: lineInstances(lines, () => Color.WHITE.withAlpha(0.45), 1),
          appearance: new PolylineColorAppearance({ translucent: true }),
          asynchronous: true,
        }),
      ) as Primitive;
      scene.requestRender();
    },
    setCoastlinesVisible(show) {
      if (coastPrimitive) coastPrimitive.show = show;
      scene.requestRender();
    },

    setPickMarker(lat, lon) {
      pickMarker.removeAll();
      const ground = scene.globe.getHeight(Cartographic.fromDegrees(lon, lat)) ?? 0;
      pickMarker.add({
        position: Cartesian3.fromDegrees(lon, lat, ground + 2),
        pixelSize: 12,
        color: Color.TRANSPARENT,
        outlineColor: Color.WHITE,
        outlineWidth: 3,
        disableDepthTestDistance: 0,
      });
      scene.requestRender();
    },
    clearPickMarker() {
      pickMarker.removeAll();
      scene.requestRender();
    },

    setHover(fn) {
      hoverListener = fn;
      if (!fn) scene.canvas.style.cursor = "";
    },

    setXray(on) {
      const t = scene.globe.translucency;
      t.enabled = on;
      // Nearly clear up close so buried points read clearly; a little firmer from far away so the
      // continents still anchor the view and the far side of the planet does not crowd in.
      t.frontFaceAlphaByDistance = new NearFarScalar(4e5, 0.18, 2.5e7, 0.55);
      t.backFaceAlpha = 0;
      scene.requestRender();
    },

    setSection(line, depthKm = 700) {
      for (const p of [sectionLine, sectionWall]) if (p) scene.primitives.remove(p);
      sectionLine = sectionWall = null;
      sectionLabels.removeAll();
      if (line && line.length > 1) {
        const surface = Cartesian3.fromDegreesArrayHeights(line.flatMap((p) => [p.lon, p.lat, 3000]));
        const gold = Color.fromCssColorString("#ffd166");
        sectionLine = scene.primitives.add(
          new Primitive({
            geometryInstances: new GeometryInstance({
              geometry: new PolylineGeometry({ positions: surface, width: 3, arcType: ArcType.NONE, vertexFormat: PolylineColorAppearance.VERTEX_FORMAT }),
              attributes: { color: ColorGeometryInstanceAttribute.fromColor(gold) },
            }),
            appearance: new PolylineColorAppearance({ translucent: false }),
            asynchronous: false,
          }),
        ) as Primitive;
        sectionWall = scene.primitives.add(
          new Primitive({
            geometryInstances: new GeometryInstance({
              geometry: new WallGeometry({
                positions: Cartesian3.fromDegreesArrayHeights(line.flatMap((p) => [p.lon, p.lat, 0])),
                minimumHeights: line.map(() => -depthKm * 1000),
                maximumHeights: line.map(() => 0),
                vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
              }),
              attributes: { color: ColorGeometryInstanceAttribute.fromColor(gold.withAlpha(0.16)) },
            }),
            appearance: new PerInstanceColorAppearance({ translucent: true, flat: true, closed: false }),
            asynchronous: false,
          }),
        ) as Primitive;
        const ends: [string, { lat: number; lon: number }][] = [["A", line[0]], ["B", line[line.length - 1]]];
        for (const [text, p] of ends) {
          sectionLabels.add({
            text,
            position: Cartesian3.fromDegrees(p.lon, p.lat, 3000),
            font: "600 15px Inter, system-ui, sans-serif",
            fillColor: Color.fromCssColorString("#0b1220"),
            outlineColor: gold,
            outlineWidth: 6,
            style: LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: HorizontalOrigin.CENTER,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -6),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          });
        }
      }
      scene.requestRender();
    },

    setSectionPreview(a, b) {
      preview.show = Boolean(a && b);
      previewPositions = a && b ? Cartesian3.fromDegreesArrayHeights([a.lon, a.lat, 3000, b.lon, b.lat, 3000]) : [];
      scene.requestRender();
    },

    setMode(mode) {
      const want = mode === "2d" ? SceneMode.SCENE2D : SceneMode.SCENE3D;
      if (scene.mode === want) return;
      if (mode === "2d") scene.morphTo2D(0.8);
      else scene.morphTo3D(0.8);
    },
    setAutoRotate(on) {
      rotating = on;
      lastTick = performance.now();
      scene.requestRender();
    },
    async groundHeight(lat, lon) {
      const carto = Cartographic.fromDegrees(lon, lat);
      try {
        await sampleTerrain(viewer.terrainProvider, 13, [carto]);
      } catch {
        return scene.globe.getHeight(carto) ?? 0;
      }
      return carto.height || 0;
    },
    setTheme(theme) {
      scene.backgroundColor = Color.fromCssColorString(theme === "dark" ? "#05080f" : "#dfe6ee");
      if (scene.skyBox) scene.skyBox.show = theme === "dark";
      if (scene.sun) scene.sun.show = false;
      if (scene.moon) scene.moon.show = false;
      scene.requestRender();
    },
  };
  return api;
}
