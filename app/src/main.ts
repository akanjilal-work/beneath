import "./styles.css";
import type { ImageryLayer } from "cesium";
import { DepositIndex, type Deposit, type DepositsFile } from "./data/deposits";
import { Gazetteer, placeLabel, type PlacesFile } from "./data/gazetteer";
import { fetchJson, findLayer, loadManifest, type Manifest, type RasterEntry } from "./data/manifest";
import { PlateModel, type FeatureCollection } from "./data/plates";
import { LIVE_QUAKES_URL, QuakeIndex, quakesFromFeed, quakesFromFile, type Quake, type QuakesFile, type UsgsFeed } from "./data/quakes";
import { Section, type LatLon } from "./lib/section";
import { createGlobe, type Globe } from "./render/globe";
import { createSurfaceView, type MoveAction } from "./render/surface";
import { elevationProfile } from "./render/elevation";
import { QuakeLayer } from "./render/quakes";
import { createValueLayer } from "./render/valueImagery";
import { ValueSource } from "./render/valueSource";
import { MAX_DEPTH, Store, parseHash, type AppState, type OverlayId } from "./state";
import { renderCard, renderCardLoading, type PointFacts } from "./ui/card";
import { depthWeights, nearestStop, renderLegend, renderSources, setupControls } from "./ui/controls";
import { $ } from "./ui/dom";
import { createKpBadge } from "./ui/kp";
import { setupSearch } from "./ui/search";
import { hideSection, renderSection } from "./ui/section";

const DEPOSIT_RADIUS_KM = 50;
const QUAKE_RADIUS_KM = 100;
const LIVE_QUAKES_POLL_MS = 10 * 60 * 1000;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Data {
  manifest: Manifest;
  rasters: Record<"magnetic" | "gravity", RasterEntry | undefined>;
  sources: Partial<Record<"magnetic" | "gravity", ValueSource>>;
  plates: PlateModel | null;
  deposits: DepositIndex | null;
  quakes: QuakeIndex | null;
  gazetteer: Gazetteer | null;
}

function applyTheme(theme: AppState["theme"], globe?: Globe) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#05080f" : "#dfe6ee");
  $("theme-toggle").setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  globe?.setTheme(theme);
}

function showError(message: string) {
  const loading = $("loading");
  loading.classList.add("error");
  loading.replaceChildren(message);
}

async function main() {
  const { state: initial, hadView } = parseHash(location.hash);
  const store = new Store(initial);
  applyTheme(initial.theme);

  let manifest: Manifest;
  try {
    manifest = await loadManifest();
  } catch (err) {
    console.error(err);
    showError("The data layers could not be loaded. Please try again later.");
    return;
  }

  const globe = await createGlobe($("globe"), $("credits"));
  // Handle for local debugging and browser tests; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { beneath: unknown }).beneath = { globe };
  applyTheme(initial.theme, globe);

  const data: Data = {
    manifest,
    rasters: {
      magnetic: findLayer(manifest, "magnetic", "raster-value"),
      gravity: findLayer(manifest, "gravity", "raster-value"),
    },
    sources: {},
    plates: null,
    deposits: null,
    quakes: null,
    gazetteer: null,
  };

  // --- value layers ------------------------------------------------------------------
  const valueLayers: Partial<Record<"magnetic" | "gravity", ImageryLayer>> = {};
  const buildValueLayers = () => {
    for (const id of ["magnetic", "gravity"] as const) {
      const entry = data.rasters[id];
      if (!entry) continue;
      data.sources[id] ??= new ValueSource(entry);
      const old = valueLayers[id];
      const layer = createValueLayer(data.sources[id]!, { ramp: store.state.ramp, relief: store.state.relief });
      if (old) {
        const index = globe.viewer.imageryLayers.indexOf(old);
        globe.viewer.imageryLayers.remove(old, true);
        globe.viewer.imageryLayers.add(layer, index);
      } else {
        globe.addValueLayer(layer);
      }
      valueLayers[id] = layer;
    }
  };
  buildValueLayers();

  const applyDepth = (s: AppState) => {
    const w = depthWeights(s.depth);
    const set = (layer: ImageryLayer | undefined, alpha: number) => {
      if (!layer) return;
      layer.alpha = alpha;
      layer.show = alpha > 0.01;
    };
    set(valueLayers.magnetic, w[1]);
    set(valueLayers.gravity, w[2]);
    if (data.plates) {
      void globe.setPlateFill(data.plates, w[3] * 0.55);
      globe.setBoundaryEmphasis(w[3]);
      globe.setBoundaryVisible(s.overlays.has("boundaries") || w[3] > 0.01);
    }
    globe.viewer.scene.requestRender();
  };

  // --- overlays ----------------------------------------------------------------------
  const available = new Set<OverlayId>(["live"]);
  if (manifest.layers.some((l) => l.id === "earthquakes")) available.add("quakes");
  if (manifest.layers.some((l) => l.id === "deposits")) available.add("deposits");
  if (manifest.layers.some((l) => l.id === "plates")) available.add("boundaries");
  if (manifest.layers.some((l) => l.id === "coastlines")) available.add("coastlines");
  setupControls(store, available);
  renderSources(manifest);

  const kp = createKpBadge();
  const quakeLayer = new QuakeLayer(globe.viewer.scene);
  let depositsDrawn = false;
  const applyOverlays = (s: AppState) => {
    kp.setActive(s.overlays.has("live"));
    quakeLayer.setVisible(s.overlays.has("quakes"));
    globe.setCoastlinesVisible(s.overlays.has("coastlines"));
    if (s.overlays.has("deposits") && data.deposits && !depositsDrawn) {
      globe.setDeposits(data.deposits.deposits);
      depositsDrawn = true;
    }
    globe.setDepositsVisible(s.overlays.has("deposits"));
    applyDepth(s);
  };

  const legend = () => renderLegend(store.state, manifest, data.rasters, data.plates, data.quakes);

  // --- see beneath ---------------------------------------------------------------------
  const applyXray = (s: AppState) => {
    globe.setXray(s.xray);
    quakeLayer.setDeep(s.xray);
    document.body.classList.toggle("xray", s.xray);
  };
  const xrayToggle = $("xray-toggle") as HTMLInputElement;
  xrayToggle.addEventListener("change", () => setXray(xrayToggle.checked));
  store.subscribe((s) => (xrayToggle.checked = s.xray));
  xrayToggle.checked = initial.xray;
  const setXray = (on: boolean) => {
    // Seeing beneath is about the earthquakes, so switching it on also shows them.
    if (on && available.has("quakes")) store.toggleOverlay("quakes", true);
    store.set({ xray: on });
  };

  // --- camera ------------------------------------------------------------------------
  let autoRotate = !hadView && !initial.pick && !reducedMotion;
  globe.setView(initial.lat, initial.lon, initial.alt);
  if (initial.mode === "2d") globe.setMode("2d");
  globe.setAutoRotate(autoRotate);
  globe.onInteract(() => {
    if (autoRotate) {
      autoRotate = false;
      globe.setAutoRotate(false);
    }
  });
  globe.onCameraIdle((lat, lon, alt) => {
    if (!autoRotate) store.set({ lat, lon, alt });
  });

  // --- click card --------------------------------------------------------------------
  const card = $("click-card");
  let queryId = 0;

  const closeCard = () => {
    card.hidden = true;
    globe.clearPickMarker();
    store.set({ pick: null });
  };
  $("card-close").addEventListener("click", closeCard);

  const openCard = async (lat: number, lon: number, picked: Deposit | null = null, pickedQuake: Quake | null = null) => {
    const id = ++queryId;
    store.set({ pick: { lat, lon } });
    globe.setPickMarker(lat, lon);
    card.hidden = false;
    // Close the layers sheet on mobile so the card has room.
    $("layers-panel").classList.remove("open");
    renderCardLoading(lat, lon);

    const [mag, grav] = await Promise.all(
      (["magnetic", "gravity"] as const).map((k) => data.sources[k]?.sample(lon, lat).catch(() => NaN) ?? Promise.resolve(null)),
    );
    if (id !== queryId) return;
    const near = data.gazetteer?.nearest(lat, lon);
    const facts: PointFacts = {
      lat,
      lon,
      place: near ? { label: placeLabel(near.place), distanceKm: near.distanceKm } : null,
      magnetic: mag === null || !data.rasters.magnetic ? null : { value: mag, units: data.rasters.magnetic.units },
      gravity: grav === null || !data.rasters.gravity ? null : { value: grav, units: data.rasters.gravity.units },
      plate: data.plates?.plateAt(lon, lat) ?? null,
      boundary: data.plates?.nearestBoundary(lon, lat) ?? null,
      deposits: data.deposits ? data.deposits.near(lon, lat, DEPOSIT_RADIUS_KM, 5) : null,
      depositRadiusKm: DEPOSIT_RADIUS_KM,
      quakes: data.quakes ? data.quakes.summarise(lon, lat, QUAKE_RADIUS_KM) : null,
      quakeRadiusKm: QUAKE_RADIUS_KM,
      pickedQuake,
      picked,
      depthStop: nearestStop(store.state.depth),
    };
    renderCard(facts, {
      onCopy: () => {
        const url = store.shareUrl();
        void navigator.clipboard?.writeText(url).catch(() => prompt("Copy this link", url));
      },
      onSurface: (lat, lon) => void goToSurface(lat, lon),
      onSection: (lat, lon) => startDrawing({ lat, lon }),
    });
  };

  // --- cross-section ---------------------------------------------------------------------
  const hint = $("draw-hint");
  let draft: { a: LatLon | null } | null = null;

  const stopDrawing = () => {
    draft = null;
    document.body.classList.remove("drawing");
    hint.hidden = true;
    globe.setHover(null);
    globe.setSectionPreview(null);
  };
  const startDrawing = (from: LatLon | null = null) => {
    autoRotate = false;
    globe.setAutoRotate(false);
    if (surface.active) surface.exit();
    if (store.state.mode === "2d") store.set({ mode: "3d" });
    draft = { a: from };
    document.body.classList.add("drawing");
    hint.hidden = false;
    $("draw-hint-text").textContent = from ? "Click where the section should end" : "Click where the section should start";
    if (window.matchMedia("(max-width: 760px)").matches) closeCard();
    globe.setHover((lon, lat) => {
      if (draft?.a) globe.setSectionPreview(draft.a, { lat, lon });
    });
  };
  $("section-button").addEventListener("click", () => (draft ? stopDrawing() : startDrawing()));
  $("draw-cancel").addEventListener("click", stopDrawing);

  // Coarser elevation tiles for longer lines: 200 samples never need finer than their spacing.
  const sectionHeights = (points: LatLon[], lengthKm: number) =>
    elevationProfile(points, lengthKm < 400 ? 10 : lengthKm < 1500 ? 8 : lengthKm < 4000 ? 7 : 6);
  const applySection = (s: AppState) => {
    document.body.classList.toggle("section-open", Boolean(s.section));
    if (!s.section) {
      hideSection();
      globe.setSection(null);
      return;
    }
    const section = new Section(s.section.a, s.section.b);
    globe.setSection(section.sample(Math.max(8, Math.min(128, Math.round(section.lengthKm / 40)))), 700);
    void renderSection(
      {
        state: s.section,
        quakes: data.quakes,
        plates: data.plates,
        heights: sectionHeights,
        magnetic: data.sources.magnetic ? (lon, lat) => data.sources.magnetic!.sample(lon, lat) : undefined,
        gravity: data.sources.gravity ? (lon, lat) => data.sources.gravity!.sample(lon, lat) : undefined,
        xray: s.xray,
      },
      {
        onWidth: (w) => store.set({ section: { ...store.state.section!, w } }),
        onClose: () => store.set({ section: null }),
        onRedraw: () => startDrawing(),
        onXray: setXray,
        onCopy: () => {
          const url = store.shareUrl();
          void navigator.clipboard?.writeText(url).catch(() => prompt("Copy this link", url));
        },
      },
    );
  };

  // --- surface view ------------------------------------------------------------------
  const surface = createSurfaceView(globe.viewer);
  const hud = $("surface-hud");
  const agl = $("surface-agl");
  let depthBeforeSurface: number | null = null;

  const goToSurface = async (lat: number, lon: number) => {
    autoRotate = false;
    globe.setAutoRotate(false);
    if (store.state.mode === "2d") store.set({ mode: "3d" });
    // Start on plain imagery so the land itself is visible; the depth slider still works.
    if (!surface.active) depthBeforeSurface = store.state.depth;
    store.set({ depth: 0 });
    if (window.matchMedia("(max-width: 760px)").matches) closeCard();
    const ground = await globe.groundHeight(lat, lon);
    surface.enter(lat, lon, ground);
  };

  surface.onChange((active) => {
    document.body.classList.toggle("surface", active);
    hud.hidden = !active;
    if (!active && depthBeforeSurface !== null) {
      store.set({ depth: depthBeforeSurface });
      depthBeforeSurface = null;
    }
  });
  surface.onHeight((h) => {
    agl.textContent = h >= 1000 ? `${(h / 1000).toFixed(1)} km above ground` : `${Math.round(h)} m above ground`;
  });
  $("surface-exit").addEventListener("click", () => surface.exit());
  hud.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((b) => {
    const action = b.dataset.move as MoveAction;
    b.addEventListener("pointerdown", (e) => {
      b.setPointerCapture(e.pointerId);
      surface.press(action, true);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      b.addEventListener(type, () => surface.press(action, false));
    }
  });

  globe.onPick((lon, lat, deposit, quake) => {
    if (draft) {
      const point = { lat, lon };
      if (!draft.a) {
        draft.a = point;
        $("draw-hint-text").textContent = "Click where the section should end";
        return;
      }
      const a = draft.a;
      stopDrawing();
      store.set({ section: { a, b: point, w: store.state.section?.w ?? 100 } });
      return;
    }
    void openCard(lat, lon, deposit, quake);
  });

  setupSearch(
    () => data.gazetteer,
    (lat, lon) => {
      globe.flyTo(lat, lon, 1_500_000, reducedMotion ? 0 : 1.6);
      void openCard(lat, lon);
    },
  );

  // --- top bar -----------------------------------------------------------------------
  const modeButtons = document.querySelectorAll<HTMLButtonElement>(".segmented [data-mode]");
  modeButtons.forEach((b) => b.addEventListener("click", () => store.set({ mode: b.dataset.mode as AppState["mode"] })));
  $("theme-toggle").addEventListener("click", () => store.set({ theme: store.state.theme === "dark" ? "light" : "dark" }));
  const help = $("help-dialog") as HTMLDialogElement;
  $("help-button").addEventListener("click", () => help.showModal());

  const syncMode = (s: AppState) =>
    modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === s.mode)));
  syncMode(initial);

  // --- keyboard ----------------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, select, textarea, dialog")) return;
    if (e.key === "/") {
      ($("search-input") as HTMLInputElement).focus();
      e.preventDefault();
    } else if (e.key === "[" || e.key === "]") {
      const step = e.key === "]" ? 1 : -1;
      const next = Math.max(0, Math.min(MAX_DEPTH, Math.round(store.state.depth) + step));
      store.set({ depth: next });
    } else if (e.key === "x" || e.key === "X") {
      setXray(!store.state.xray);
    } else if (e.key === "c" || e.key === "C") {
      if (draft) stopDrawing();
      else startDrawing();
    } else if (e.key === "Escape" && draft) {
      stopDrawing();
    } else if (e.key === "Escape" && !card.hidden) {
      closeCard();
    } else if (e.key === "Escape" && surface.active) {
      surface.exit();
    }
  });

  // --- react to state ----------------------------------------------------------------
  store.subscribe((s, changed) => {
    if (changed.has("depth")) applyDepth(s);
    if (changed.has("overlays")) applyOverlays(s);
    if (changed.has("ramp") || changed.has("relief")) {
      buildValueLayers();
      applyDepth(s);
    }
    if (changed.has("mode")) {
      globe.setMode(s.mode);
      syncMode(s);
    }
    if (changed.has("theme")) applyTheme(s.theme, globe);
    if (changed.has("xray")) {
      applyXray(s);
      const box = document.querySelector<HTMLInputElement>("#section-head input[type=checkbox]");
      if (box) box.checked = s.xray;
    }
    if (changed.has("section")) applySection(s);
    if (changed.has("depth") || changed.has("overlays") || changed.has("ramp") || changed.has("xray")) legend();
  });

  applyOverlays(store.state);
  applyXray(store.state);
  legend();
  // Keep the click card clear of the legend stack, whose height changes with the layers.
  const legendEl = $("legend");
  new ResizeObserver(() => {
    const bottom = window.innerHeight - legendEl.getBoundingClientRect().top;
    document.documentElement.style.setProperty("--legend-h", `${Math.max(0, bottom)}px`);
  }).observe(legendEl);

  // First frame is up; drop the loading screen.
  $("loading").classList.add("done");

  // --- secondary data, loaded after the globe is interactive ------------------------
  const platesEntry = findLayer(manifest, "plates", "vector");
  const depositsEntry = findLayer(manifest, "deposits", "points");
  const placesEntry = findLayer(manifest, "places", "gazetteer");
  const quakesEntry = findLayer(manifest, "earthquakes", "points");
  const coastEntry = findLayer(manifest, "coastlines", "vector");

  const loads: Promise<unknown>[] = [];
  if (platesEntry) {
    loads.push(
      Promise.all([
        fetchJson<FeatureCollection<never>>(platesEntry.file),
        platesEntry.polygons ? fetchJson<FeatureCollection<never>>(platesEntry.polygons) : Promise.resolve(null),
      ]).then(([lines, polys]) => {
        data.plates = new PlateModel(lines, polys);
        globe.setBoundaries(data.plates, depthWeights(store.state.depth)[3]);
        applyDepth(store.state);
        legend();
      }),
    );
  }
  if (placesEntry) {
    loads.push(fetchJson<PlacesFile>(placesEntry.file).then((f) => (data.gazetteer = new Gazetteer(f))));
  }
  if (depositsEntry) {
    loads.push(
      fetchJson<DepositsFile>(depositsEntry.file).then((f) => {
        data.deposits = new DepositIndex(f);
        applyOverlays(store.state);
      }),
    );
  }
  if (quakesEntry) {
    loads.push(
      fetchJson<QuakesFile>(quakesEntry.file).then((f) => {
        data.quakes = new QuakeIndex(quakesFromFile(f));
        quakeLayer.add(data.quakes.quakes);
        legend();
        void pollLiveQuakes();
      }),
    );
  }
  // The past week from the USGS live feed, merged into the catalogue and refreshed while open.
  const seenLive = new Set<string>();
  const pollLiveQuakes = async () => {
    try {
      const res = await fetch(LIVE_QUAKES_URL, { cache: "no-cache" });
      if (!res.ok || !data.quakes) return;
      const feed = (await res.json()) as UsgsFeed;
      feed.features = feed.features.filter((f) => !seenLive.has(f.id));
      feed.features.forEach((f) => seenLive.add(f.id));
      const fresh = data.quakes.addRecent(quakesFromFeed(feed, data.quakes.quakes.length));
      quakeLayer.add(fresh);
      legend();
    } catch (err) {
      console.warn("Live earthquake feed unavailable", err);
    } finally {
      window.setTimeout(() => void pollLiveQuakes(), LIVE_QUAKES_POLL_MS);
    }
  };
  if (coastEntry) {
    loads.push(
      fetchJson<{ features: { geometry: { type: string; coordinates: number[][] | number[][][] } }[] }>(coastEntry.file).then((f) => {
        const lines: number[][][] = [];
        for (const feat of f.features) {
          if (feat.geometry.type === "LineString") lines.push(feat.geometry.coordinates as number[][]);
          else if (feat.geometry.type === "MultiLineString") lines.push(...(feat.geometry.coordinates as number[][][]));
        }
        globe.setCoastlines(lines);
        globe.setCoastlinesVisible(store.state.overlays.has("coastlines"));
      }),
    );
  }

  const results = await Promise.allSettled(loads);
  for (const r of results) if (r.status === "rejected") console.warn(r.reason);

  // A shared section is drawn once the earthquakes and plates it plots are in.
  if (store.state.section) applySection(store.state);

  // A shared link with a picked point opens its card once the supporting data is in.
  if (initial.pick) {
    if (!hadView) globe.flyTo(initial.pick.lat, initial.pick.lon, 2_000_000, 0);
    void openCard(initial.pick.lat, initial.pick.lon);
  }
}

main().catch((err) => {
  console.error(err);
  showError(
    /webgl/i.test(String(err))
      ? "Your browser could not start WebGL, which Beneath needs to draw the globe."
      : "Something went wrong while starting Beneath.",
  );
});
