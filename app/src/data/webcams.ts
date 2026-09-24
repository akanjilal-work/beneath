// Public traffic cameras from a daily snapshot (Caltrans, 511NY). The camera list is static;
// the image each camera links to is refreshed by its agency every few minutes.

export interface WebcamSource {
  id: string;
  name: string;
  url: string;
  updateMinutes: number;
}

export interface WebcamsFile {
  updated: string;
  fields: string[];
  sources: WebcamSource[];
  cams: [number, number, string, string, number][];
}

export interface Webcam {
  kind: "webcam";
  index: number;
  lon: number;
  lat: number;
  name: string;
  image: string;
  source: WebcamSource;
}

export function webcamsFromFile(file: WebcamsFile): Webcam[] {
  return file.cams
    .filter(([lon, lat, , image]) => Number.isFinite(lon) && Number.isFinite(lat) && /^https:\/\//.test(image))
    .map(([lon, lat, name, image, s], index) => ({ kind: "webcam", index, lon, lat, name, image, source: file.sources[s] }));
}

/** The camera image with a cache-busting parameter, so each refresh fetches the latest frame. */
export function freshImage(cam: Webcam, now = Date.now()): string {
  const url = new URL(cam.image);
  url.searchParams.set("t", String(Math.floor(now / 60_000)));
  return url.toString();
}
