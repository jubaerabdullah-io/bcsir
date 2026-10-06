// Texture atlas of a generated building model: one square image (1024 px),
// painted procedurally, from perspective-corrected photo crops and from text,
// encoded as WebP. Regions are [x, y, width, height] in pixels.
import { existsSync } from "node:fs";
import sharp from "sharp";

export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hash = (x, y, seed) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// Smooth value noise in [0, 1] with a cell size in pixels.
export function valueNoise(x, y, cell, seed) {
  const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
// Concrete: base colour with fine grain and soft blotches (percent).
export const concrete = (base, x, y, seed, grain = 4, blotch = 6) => {
  const k = 1 + ((hash(x, y, seed) - 0.5) * grain + (valueNoise(x, y, 24, seed + 1) - 0.5) * blotch) / 100;
  return scale(base, k);
};

// Homography mapping the unit square (u right, v down) onto a quad [TL, TR, BR, BL].
function homography(quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return (u, v) => { const z = g * u + h * v + 1; return [(a * u + b * v + c) / z, (d * u + e * v + f) / z]; };
}

export function createAtlas(size = 1024) {
  const pixels = new Float32Array(size * size * 3).fill(128);
  const alpha = new Uint8Array(size * size).fill(255); // colours may carry a 4th value: alpha (cut-out parts)
  const idx = (x, y) => (y * size + x) * 3;
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= size || y >= size) return; const i = idx(x, y); pixels[i] = c[0]; pixels[i + 1] = c[1]; pixels[i + 2] = c[2]; alpha[y * size + x] = c.length > 3 ? Math.max(0, Math.min(255, Math.round(c[3]))) : 255; };
  const get = (x, y) => { const i = idx(x, y); return [pixels[i], pixels[i + 1], pixels[i + 2]]; };
  // fn(x, y, w, h, current) -> colour, for every pixel of the region (local coordinates).
  const paint = ([x0, y0, w, h], fn) => {
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) put(x0 + x, y0 + y, fn(x, y, w, h, get(x0 + x, y0 + y)));
  };

  // A photo region (quad in photo pixels, TL TR BR BL) rectified into `region`.
  // clean(colour) may return a replacement for unwanted pixels (e.g. foliage).
  // Returns false when the photo is missing.
  async function photo(region, file, quad, { clean = null, sharpen = 0.6 } = {}) {
    if (!existsSync(file)) return false;
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (xx, yy) => { const i = (yy * info.width + xx) * 3; return [data[i], data[i + 1], data[i + 2]]; };
    const sample = (sx, sy) => {
      const xi = Math.max(0, Math.min(info.width - 2, Math.floor(sx))), yi = Math.max(0, Math.min(info.height - 2, Math.floor(sy)));
      const fx = sx - xi, fy = sy - yi;
      return mix(mix(at(xi, yi), at(xi + 1, yi), fx), mix(at(xi, yi + 1), at(xi + 1, yi + 1), fx), fy);
    };
    const map = homography(quad);
    paint(region, (x, y, w, h) => { const c = sample(...map((x + 0.5) / w, (y + 0.5) / h)); return clean?.(c) || c; });
    if (sharpen > 0) {
      const [x0, y0, w, h] = region;
      const copy = new Float32Array(pixels);
      for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
        const i = idx(x0 + x, y0 + y);
        for (let k = 0; k < 3; k += 1) {
          const blur = (copy[i - 3 + k] + copy[i + 3 + k] + copy[i - size * 3 + k] + copy[i + size * 3 + k]) / 4;
          pixels[i + k] = copy[i + k] + sharpen * (copy[i + k] - blur);
        }
      }
    }
    return true;
  }

  // Lines of text centred in `region` over its current content:
  // lines = [{ text, height (share of the region height), top (share), color, bold }].
  // Bangla is shaped by Pango (sharp) with the Nirmala UI font where installed.
  async function text(region, lines) {
    const [x0, y0, w, h] = region;
    for (const line of lines) {
      const markup = `<span foreground="${line.color || "#ffffff"}"${line.bold ? ' font_weight="bold"' : ""}>${line.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`;
      const rendered = await sharp({ text: { text: markup, font: line.font || "Nirmala UI", rgba: true, dpi: 300 } }).png().toBuffer();
      const targetH = Math.max(4, Math.round(h * line.height));
      const meta = await sharp(rendered).metadata();
      const targetW = Math.min(Math.round(w * (line.maxWidth || 0.94)), Math.round(meta.width * targetH / meta.height));
      const { data, info } = await sharp(rendered).resize(targetW, targetH, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
      const left = x0 + Math.round((w - info.width) / 2), top = y0 + Math.round(h * line.top);
      for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
        const i = (y * info.width + x) * 4, a = data[i + 3] / 255;
        if (a <= 0) continue;
        put(left + x, top + y, mix(get(left + x, top + y), [data[i], data[i + 1], data[i + 2]], a));
      }
    }
  }

  const hasAlpha = () => alpha.some((a) => a < 255);
  async function encode(quality = 86) {
    const channels = hasAlpha() ? 4 : 3;
    const bytes = Buffer.alloc(size * size * channels);
    for (let p = 0; p < size * size; p += 1) {
      for (let k = 0; k < 3; k += 1) bytes[p * channels + k] = Math.max(0, Math.min(255, Math.round(pixels[p * 3 + k])));
      if (channels === 4) bytes[p * 4 + 3] = alpha[p];
    }
    return sharp(bytes, { raw: { width: size, height: size, channels } }).webp({ quality, alphaQuality: 100, effort: 6 }).toBuffer();
  }

  return { size, put, get, paint, photo, text, encode, hasAlpha };
}
