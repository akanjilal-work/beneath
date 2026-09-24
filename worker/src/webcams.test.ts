import { describe, expect, it } from "vitest";
import { normaliseWebcams, webcamQuery, windyPageUrl } from "./webcams";

describe("webcams", () => {
  it("rounds the view and caps the radius", () => {
    expect(webcamQuery(new URLSearchParams("lat=43.68&lon=-79.62&r=80"))).toEqual({ lat: 43.5, lon: -79.5, radius: 100 });
    expect(webcamQuery(new URLSearchParams("lat=43&lon=-79&r=5000"))?.radius).toBe(250);
    expect(webcamQuery(new URLSearchParams("lon=1"))).toBeNull();
  });
  it("asks Windy for one page of nearby cameras", () => {
    const u = new URL(windyPageUrl({ lat: 43.5, lon: -79.5, radius: 100 }, 2));
    expect(u.searchParams.get("nearby")).toBe("43.5,-79.5,100");
    expect(u.searchParams.get("offset")).toBe("100");
    expect(u.searchParams.get("include")).toBe("location,images,urls");
  });
  it("keeps active cameras with a preview, once each", () => {
    const cam = (id: number, status = "active") => ({
      webcamId: id,
      title: `Cam ${id}`,
      status,
      location: { latitude: 43.7, longitude: -79.6 },
      images: { current: { preview: `https://img/${id}.jpg` } },
      urls: { detail: `https://windy.com/webcams/${id}`, provider: "https://511on.ca/" },
    });
    const file = normaliseWebcams([{ webcams: [cam(1), cam(2, "inactive")] }, { webcams: [cam(1), { webcamId: 3, status: "active" }] }]);
    expect(file.webcams).toEqual([[1, -79.6, 43.7, "Cam 1", "https://img/1.jpg", "https://windy.com/webcams/1", "https://511on.ca/"]]);
  });
});
