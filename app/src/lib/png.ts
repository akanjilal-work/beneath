// Minimal PNG decoder for value-encoded tiles.
//
// Decoding through <canvas> is unsafe for data tiles: browsers may apply colour
// management or premultiplied alpha, which silently changes the encoded values.
// This decoder reads the bytes exactly. It supports 8-bit greyscale, RGB, RGBA and
// palette images without interlacing, which covers everything the pipeline writes.

export interface DecodedPng {
  width: number;
  height: number;
  /** Always RGB, 3 bytes per pixel. */
  rgb: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error("Not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  while (pos < bytes.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("Interlaced PNG not supported");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error("Palette PNG without PLTE");

  let total = 0;
  for (const chunk of idat) total += chunk.length;
  const compressed = new Uint8Array(total);
  let offset = 0;
  for (const chunk of idat) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  const raw = await inflate(compressed);

  // Undo per-scanline filters in place into `pixels`.
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? out[i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      switch (filter) {
        case 0:
          break;
        case 1:
          v += left;
          break;
        case 2:
          v += up;
          break;
        case 3:
          v += (left + up) >> 1;
          break;
        case 4:
          v += paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Bad PNG filter ${filter}`);
      }
      out[i] = v & 0xff;
    }
    prev = out;
  }

  if (colorType === 2) return { width, height, rgb: pixels };

  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) {
    if (colorType === 6) {
      rgb[j] = pixels[i * 4];
      rgb[j + 1] = pixels[i * 4 + 1];
      rgb[j + 2] = pixels[i * 4 + 2];
    } else if (colorType === 3) {
      const p = pixels[i] * 3;
      rgb[j] = palette![p];
      rgb[j + 1] = palette![p + 1];
      rgb[j + 2] = palette![p + 2];
    } else {
      const g = pixels[i * channels];
      rgb[j] = g;
      rgb[j + 1] = g;
      rgb[j + 2] = g;
    }
  }
  return { width, height, rgb };
}
