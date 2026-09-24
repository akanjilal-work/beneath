// Public cameras. Traffic cameras come from a daily snapshot (Caltrans, 511NY, Ontario 511) and
// their images refresh at the agency every few minutes. Webcams near the view come live from
// Windy through the Beneath Worker, which holds the API key.

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
  /** lon, lat, name, image, source index, and an optional page link (Windy cameras). */
  cams: [number, number, string, string, number, string?][];
}

export interface Webcam {
  kind: "webcam";
  index: number;
  lon: number;
  lat: number;
  name: string;
  image: string;
  source: WebcamSource;
  /** Page for the camera on its provider's site (Windy cameras link back, as their terms ask). */
  link?: string;
}

export const WINDY_SOURCE: WebcamSource = { id: "windy", name: "Webcams provided by windy.com", url: "https://www.windy.com/webcams", updateMinutes: 10 };

export interface WindyFile {
  source: string;
  fields: string[];
  webcams: [number, number, number, string, string, string, string][];
}

export function windyCamsFromFile(file: WindyFile, firstIndex: number): Webcam[] {
  return file.webcams
    .filter(([, lon, lat, , image]) => Number.isFinite(lon) && Number.isFinite(lat) && /^https:\/\//.test(image))
    .map(([, lon, lat, name, image, link], i) => ({ kind: "webcam", index: firstIndex + i, lon, lat, name, image, source: WINDY_SOURCE, link }));
}

export function webcamsFromFile(file: WebcamsFile): Webcam[] {
  return file.cams
    .filter(([lon, lat, , image]) => Number.isFinite(lon) && Number.isFinite(lat) && /^https:\/\//.test(image))
    .map(([lon, lat, name, image, s, link], index) => ({ kind: "webcam", index, lon, lat, name, image, source: file.sources[s], link }));
}

/** The camera image with a cache-busting parameter, so each refresh fetches the latest frame. */
export function freshImage(cam: Webcam, now = Date.now()): string {
  const url = new URL(cam.image);
  url.searchParams.set("t", String(Math.floor(now / 60_000)));
  return url.toString();
}
