import { UrlTemplateImageryProvider, type ImageryTypes, type Request } from "cesium";

/**
 * Imagery whose server fills areas without data with flat colour: the USGS orthoimagery returns
 * plain white outside the US and plain black over open water. Those pixels become transparent
 * so the global imagery underneath shows through. Real imagery is almost never pure black or
 * pure white, so the thresholds leave it alone.
 */
export class NoDataImageryProvider extends UrlTemplateImageryProvider {
  requestImage(x: number, y: number, level: number, request?: Request): Promise<ImageryTypes> | undefined {
    const pending = super.requestImage(x, y, level, request);
    return pending?.then(maskNoData);
  }
}

async function maskNoData(image: ImageryTypes): Promise<ImageryTypes> {
  const source = image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return image;
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  let masked = 0;
  for (let i = 0; i < px.length; i += 4) {
    const hi = Math.max(px[i], px[i + 1], px[i + 2]);
    const lo = Math.min(px[i], px[i + 1], px[i + 2]);
    if (hi <= 10 || lo >= 250) {
      px[i + 3] = 0;
      masked++;
    }
  }
  if (!masked) return image;
  ctx.putImageData(data, 0, 0);
  // Cesium decodes ImageBitmaps already flipped for upload, so keep the same kind of object
  // (and the same pixel order) that it handed us.
  return image instanceof ImageBitmap ? createImageBitmap(canvas) : canvas;
}
