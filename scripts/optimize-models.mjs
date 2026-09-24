#!/usr/bin/env node
// Usage: npm run models:optimize                  optimize new or replaced GLBs in public/models/
//        npm run models:optimize -- --force       rebuild every model from its backed-up source
//        npm run models:optimize -- mango_tree.glb  only the named model(s)
//
// Prepares the GLB models for fast loading and drawing. For every public/models/*.glb:
//
// 1. The uploaded file is kept unchanged in backup/models/source/<name>.glb (the
//    source for later rebuilds).
// 2. public/models/<name>.glb is replaced by an optimized copy with the SAME geometry
//    (LOD 0): Meshopt-compressed vertex data and WebP textures at the original
//    resolution (textures with transparency are stored lossless, keeping the colour
//    under transparent pixels, which shows through mipmapping at a distance).
//    GeoJSON files keep referencing "/models/<name>.glb".
// 3. public/models/lod/<name>.lod1-4.glb are lighter versions used when the model is
//    small on screen. Leaves and twigs (small separate pieces) are thinned out, and
//    each kept piece is enlarged about its own centre so the crown keeps its density
//    and colour; trunks and large parts are simplified. Their textures are the same
//    box-filtered mipmap levels the GPU would use at those sizes.
// 4. public/models/lod/manifest.json lists every model's levels, the screen height
//    (pixels) from which each level is used, and the bounding box of the ORIGINAL
//    model. The map fits and centres every model with that box, so positions and
//    sizes do not depend on which level is drawn.
//
// A model whose manifest entry is missing or out of date (for example a newly
// uploaded GLB) is still drawn, from its own file, until this script is run.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { compactPrimitive, dedup, flatten, getTextureColorSpace, join, meshopt, prune, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const MODELS_DIR = path.join(root, "public/models");
const LOD_DIR = path.join(MODELS_DIR, "lod");
const SOURCE_DIR = path.join(root, "backup/models/source");
const MANIFEST = path.join(LOD_DIR, "manifest.json");

// Level ladder. minPx: smallest on-screen height (pixels) at which the level is drawn
// (models under MODEL_VISIBILITY.impostorPixels, 32 px, are drawn as impostors).
// Each level was compared with renders of the original models at its largest size.
// keep: share of small pieces (leaves, twigs) kept; ratio / error: simplification of
// large pieces (meshoptimizer, error relative to the model size); texture: max size;
// seams: the two coarsest levels may merge vertices across texture seams (their
// textures are 256 px or less and the model is under 60 px tall on screen).
const LADDER = [
  { minPx: 400, keep: 1, ratio: 1, error: 0, texture: 4096 },
  { minPx: 150, keep: 0.5, ratio: 0.4, error: 0.01, texture: 1024 },
  { minPx: 60, keep: 0.2, ratio: 0.15, error: 0.03, texture: 512 },
  { minPx: 18, keep: 0.07, ratio: 0.05, error: 0.08, texture: 256, seams: true },
  { minPx: 0, keep: 0.025, ratio: 0.02, error: 0.15, texture: 128, seams: true }
];
const SMALL_PIECE = 32; // triangles; connected pieces up to this size are leaves/twigs
const MIN_PIECES = 200; // a level keeps at least this many small pieces per mesh
const LOD0_MAX_TEXTURE = 2048;
// A level is skipped when it would keep more than this share of the previous level.
const MIN_REDUCTION = 0.8;
// Models used as ground surfaces (Garden.geojson "surface_model") also get a tile
// image: the model seen from straight above, cropped to its largest fully covered
// rectangle. The map repeats it (mirrored) across the polygons.
const SURFACE_MAX_PIXELS = 1536; // longest side of the tile image
const SURFACE_MARGIN = 0.02; // share of the rectangle trimmed on each side (ragged scan edges)

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const triangles = (doc) => doc.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((s, prim) => s + (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute("POSITION").getCount()) / 3, 0), 0);

// ---- Bounding box exactly as the map computed it from the original file ---------------
// THREE.Box3().setFromObject(gltf.scene): each primitive's POSITION min/max, transformed
// by its node's world matrix (8 corners), united.
function modelBox(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const accessor = prim.getAttribute("POSITION");
      const lo = accessor.getMinNormalized([]);
      const hi = accessor.getMaxNormalized([]);
      for (let corner = 0; corner < 8; corner += 1) {
        const p = [corner & 1 ? hi[0] : lo[0], corner & 2 ? hi[1] : lo[1], corner & 4 ? hi[2] : lo[2]];
        const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
        for (let k = 0; k < 3; k += 1) {
          const v = (m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12]) / w;
          min[k] = Math.min(min[k], v);
          max[k] = Math.max(max[k], v);
        }
      }
    }
  }
  return { min, max };
}

// ---- Foliage-aware simplification ------------------------------------------------------
const hash01 = (i) => { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };

// Connected pieces: vertices joined by triangles or sharing a position (UV seams).
function pieces(indices, positions) {
  const count = positions.length / 3;
  const parent = new Int32Array(count).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < indices.length; t += 3) { unite(indices[t], indices[t + 1]); unite(indices[t], indices[t + 2]); }
  const byPosition = new Map();
  for (let v = 0; v < count; v += 1) {
    const key = `${positions[3 * v]},${positions[3 * v + 1]},${positions[3 * v + 2]}`;
    if (byPosition.has(key)) unite(v, byPosition.get(key)); else byPosition.set(key, v);
  }
  return Int32Array.from({ length: count }, (_, v) => find(v));
}

// How far each kept small piece is enlarged: keep^-exponent. Measured against renders
// of the originals: blended leaf cards keep their look with the area-preserving 0.5;
// opaque leaves overlap more, so 0.25 keeps crown colour and coverage; alpha-tested
// (MASK) cards are not thinned at all, because their coverage depends on the mipmap
// level and enlarged cards would stay visible where the original leaves fade out.
const ENLARGE_EXPONENT = { BLEND: 0.5, OPAQUE: 0.25 };

function simplifyPrimitive(prim, { keep: levelKeep, ratio, error, seams = false }) {
  const alphaMode = prim.getMaterial()?.getAlphaMode() || "OPAQUE";
  let keep = alphaMode === "MASK" ? 1 : levelKeep;
  const indexAccessor = prim.getIndices();
  const positionAccessor = prim.getAttribute("POSITION");
  const positions = new Float32Array(positionAccessor.getArray());
  const indices = new Uint32Array(indexAccessor.getArray());
  const piece = pieces(indices, positions);
  const size = new Map();
  for (let t = 0; t < indices.length; t += 3) size.set(piece[indices[t]], (size.get(piece[indices[t]]) || 0) + 1);
  const order = new Map([...size.keys()].sort((a, b) => a - b).map((id, i) => [id, i]));
  // Very few, very large leaves would change the crown's look: keep MIN_PIECES at least.
  const smallCount = [...size.values()].filter((count) => count <= SMALL_PIECE).length;
  if (keep < 1 && smallCount) keep = Math.min(1, Math.max(keep, MIN_PIECES / smallCount));

  const kept = [];
  const large = [];
  for (let t = 0; t < indices.length; t += 3) {
    const id = piece[indices[t]];
    if (size.get(id) > SMALL_PIECE) large.push(indices[t], indices[t + 1], indices[t + 2]);
    else if (hash01(order.get(id)) < keep) kept.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  if (keep < 1) {
    // Enlarge every kept leaf about its centre so the crown keeps its density.
    // Elongated pieces (twigs) are thinned but not enlarged.
    const scale = keep ** -ENLARGE_EXPONENT[alphaMode];
    const stats = new Map();
    for (const v of new Set(kept)) {
      const id = piece[v];
      const s = stats.get(id) || { sum: [0, 0, 0], n: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], vertices: [] };
      for (let k = 0; k < 3; k += 1) { const p = positions[3 * v + k]; s.sum[k] += p; s.lo[k] = Math.min(s.lo[k], p); s.hi[k] = Math.max(s.hi[k], p); }
      s.n += 1; s.vertices.push(v); stats.set(id, s);
    }
    for (const s of stats.values()) {
      const extent = [0, 1, 2].map((k) => s.hi[k] - s.lo[k]).sort((a, b) => b - a);
      if (extent[0] > 3 * Math.max(extent[1], 1e-9)) continue;
      for (const v of s.vertices) for (let k = 0; k < 3; k += 1) {
        const centre = s.sum[k] / s.n;
        positions[3 * v + k] = centre + (positions[3 * v + k] - centre) * scale;
      }
    }
  }
  let simplified = Uint32Array.from(large);
  if (ratio < 1 && large.length) {
    const target = Math.max(3, Math.floor((large.length * ratio) / 3) * 3);
    [simplified] = MeshoptSimplifier.simplify(simplified, positions, 3, target, error, seams ? ["Permissive"] : []);
  }
  const result = new Uint32Array(kept.length + simplified.length);
  result.set(kept, 0);
  result.set(simplified, kept.length);
  positionAccessor.setArray(positions);
  indexAccessor.setArray(result);
  compactPrimitive(prim);
}

// ---- Textures --------------------------------------------------------------------------
const toLinear = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSrgb = (l) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));

// One 2x2 box-filter step, like GPU mipmap generation (sRGB colour averaged in linear light).
function halve(data, width, height, srgb) {
  const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const samples = [];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) samples.push((Math.min(height - 1, 2 * y + dy) * width + Math.min(width - 1, 2 * x + dx)) * 4);
    for (let c = 0; c < 4; c += 1) {
      const o = (y * w + x) * 4 + c;
      if (srgb && c < 3) out[o] = toSrgb(samples.reduce((s, i) => s + toLinear[data[i + c]], 0) / 4);
      else out[o] = Math.round(samples.reduce((s, i) => s + data[i + c], 0) / 4);
    }
  }
  return { data: out, width: w, height: h };
}

async function compressTextures(doc, maxSize) {
  doc.createExtension(EXTTextureWebP).setRequired(true);
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    // ICC profiles are ignored: WebGL uploads the stored values unchanged.
    const decoded = await sharp(image, { ignoreIcc: true }).ensureAlpha().raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
    let level = { data: new Uint8Array(decoded.data), width: decoded.info.width, height: decoded.info.height };
    const srgb = getTextureColorSpace(texture) === "srgb";
    while (Math.max(level.width, level.height) > maxSize) level = halve(level.data, level.width, level.height, srgb);
    let transparent = false;
    for (let i = 3; i < level.data.length; i += 4) if (level.data[i] < 255) { transparent = true; break; }
    const raw = sharp(Buffer.from(level.data), { raw: { width: level.width, height: level.height, channels: 4 } });
    const encoded = transparent
      ? await raw.webp({ lossless: true, exact: true, effort: 6 }).toBuffer()
      : await raw.removeAlpha().webp({ quality: 90, effort: 6 }).toBuffer();
    texture.setImage(encoded).setMimeType("image/webp");
    if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.[a-z0-9]+$/i, ".webp"));
  }
}

// ---- Ground-surface tile: the model rendered from straight above -----------------------
// A small software rasterizer: orthographic view down the model's Y axis, the top-most
// surface wins, colour = base colour texture x vertex colour x base colour factor (what
// an unlit material such as the grass scan shows). Lit materials also get the map's model
// lights (ambient 1.5, directional 1.5 and 1) on their normals.
async function decodeImage(texture) {
  const { data, info } = await sharp(texture.getImage(), { ignoreIcc: true }).ensureAlpha().raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function sampleLinear(image, u, v, out) {
  const x = (u - Math.floor(u)) * image.width - 0.5;
  const y = (v - Math.floor(v)) * image.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (xx, yy) => ((((yy % image.height) + image.height) % image.height) * image.width + (((xx % image.width) + image.width) % image.width)) * 4;
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  for (let k = 0; k < 3; k += 1) {
    out[k] = (toLinear[image.data[a + k]] * (1 - fx) + toLinear[image.data[b + k]] * fx) * (1 - fy) + (toLinear[image.data[c + k]] * (1 - fx) + toLinear[image.data[d + k]] * fx) * fy;
  }
  return out;
}

const LIGHTS = [[1.5, [0, -70, 100]], [1, [0, 70, 100]]].map(([intensity, d]) => { const l = Math.hypot(...d); return [intensity, d.map((c) => c / l)]; });

// Largest axis-aligned rectangle of covered pixels (histogram method).
function largestRectangle(covered, width, height) {
  const heights = new Int32Array(width);
  let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) heights[x] = covered[y * width + x] ? heights[x] + 1 : 0;
    const stack = [];
    for (let x = 0; x <= width; x += 1) {
      const h = x < width ? heights[x] : 0;
      let start = x;
      while (stack.length && stack[stack.length - 1][1] >= h) {
        const [s, sh] = stack.pop();
        if (sh * (x - s) > best.area) best = { area: sh * (x - s), x: s, y: y - sh + 1, w: x - s, h: sh };
        start = s;
      }
      stack.push([start, h]);
    }
  }
  return best;
}

async function bakeSurface(doc) {
  const triangles = [];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const world = (p) => [0, 1, 2].map((k) => m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12]);
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const material = prim.getMaterial();
      const info = material?.getBaseColorTextureInfo();
      const texture = material?.getBaseColorTexture();
      const image = texture ? await decodeImage(texture) : null;
      const factor = material?.getBaseColorFactor() || [1, 1, 1, 1];
      const unlit = Boolean(material?.getExtension("KHR_materials_unlit"));
      const position = prim.getAttribute("POSITION");
      const uv = prim.getAttribute(`TEXCOORD_${info?.getTexCoord() || 0}`);
      const color = prim.getAttribute("COLOR_0");
      const indices = prim.getIndices()?.getArray() || Uint32Array.from({ length: position.getCount() }, (_, i) => i);
      const vertex = (i) => {
        const p = world(position.getElement(i, []));
        for (let k = 0; k < 3; k += 1) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
        return { p, uv: uv ? uv.getElement(i, []) : [0, 0], color: color ? color.getElement(i, []) : [1, 1, 1, 1] };
      };
      for (let t = 0; t < indices.length; t += 3) triangles.push({ v: [vertex(indices[t]), vertex(indices[t + 1]), vertex(indices[t + 2])], image, factor, unlit });
    }
  }
  const SS = 2; // supersampling
  const perUnit = SURFACE_MAX_PIXELS / Math.max(hi[0] - lo[0], hi[2] - lo[2]);
  const W = Math.ceil((hi[0] - lo[0]) * perUnit), H = Math.ceil((hi[2] - lo[2]) * perUnit);
  const w = W * SS, h = H * SS;
  const depth = new Float32Array(w * h).fill(-Infinity);
  const rgb = new Float32Array(w * h * 3);
  const sample = [0, 0, 0];
  for (const tri of triangles) {
    const [a, b, c] = tri.v;
    const px = (p) => [(p[0] - lo[0]) * perUnit * SS, (p[2] - lo[2]) * perUnit * SS];
    const [ax, ay] = px(a.p), [bx, by] = px(b.p), [cx, cy] = px(c.p);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    // Light for lit materials: face normal (either side, the top is what is seen).
    let light = 1;
    if (!tri.unlit) {
      const e1 = [0, 1, 2].map((k) => b.p[k] - a.p[k]), e2 = [0, 1, 2].map((k) => c.p[k] - a.p[k]);
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const len = Math.hypot(...n) || 1; n = n.map((v) => v / len); if (n[1] < 0) n = n.map((v) => -v);
      light = (1.5 + LIGHTS.reduce((s, [intensity, d]) => s + intensity * Math.max(0, n[0] * d[0] + n[1] * d[1] + n[2] * d[2]), 0)) / Math.PI;
    }
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const sx = x + 0.5, sy = y + 0.5;
      const w0 = ((bx - sx) * (cy - sy) - (by - sy) * (cx - sx)) / area;
      const w1 = ((cx - sx) * (ay - sy) - (cy - sy) * (ax - sx)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const top = w0 * a.p[1] + w1 * b.p[1] + w2 * c.p[1];
      const o = y * w + x;
      if (top <= depth[o]) continue;
      depth[o] = top;
      if (tri.image) sampleLinear(tri.image, w0 * a.uv[0] + w1 * b.uv[0] + w2 * c.uv[0], w0 * a.uv[1] + w1 * b.uv[1] + w2 * c.uv[1], sample);
      else sample[0] = sample[1] = sample[2] = 1;
      for (let k = 0; k < 3; k += 1) rgb[o * 3 + k] = sample[k] * (w0 * a.color[k] + w1 * b.color[k] + w2 * c.color[k]) * tri.factor[k] * light;
    }
  }
  // Downsample; a tile pixel counts as covered only when all its samples are.
  const covered = new Uint8Array(W * H);
  const pixels = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    let all = true; const sum = [0, 0, 0];
    for (let dy = 0; dy < SS; dy += 1) for (let dx = 0; dx < SS; dx += 1) {
      const o = (y * SS + dy) * w + x * SS + dx;
      if (depth[o] === -Infinity) all = false;
      for (let k = 0; k < 3; k += 1) sum[k] += rgb[o * 3 + k];
    }
    covered[y * W + x] = all ? 1 : 0;
    for (let k = 0; k < 3; k += 1) pixels[(y * W + x) * 3 + k] = toSrgb(Math.min(1, sum[k] / (SS * SS)));
  }
  const rect = largestRectangle(covered, W, H);
  const trimX = Math.round(rect.w * SURFACE_MARGIN), trimY = Math.round(rect.h * SURFACE_MARGIN);
  const crop = { left: rect.x + trimX, top: rect.y + trimY, width: rect.w - 2 * trimX, height: rect.h - 2 * trimY };
  const tile = new Float32Array(crop.width * crop.height * 3);
  for (let y = 0; y < crop.height; y += 1) for (let x = 0; x < crop.width; x += 1) for (let k = 0; k < 3; k += 1) tile[(y * crop.width + x) * 3 + k] = pixels[((crop.top + y) * W + crop.left + x) * 3 + k];
  const periodic = makePeriodic(tile, crop.width, crop.height);
  const buffer = await sharp(Buffer.from(periodic), { raw: { width: crop.width, height: crop.height, channels: 3 } }).webp({ quality: 88, effort: 6 }).toBuffer();
  // Image x runs along the model's +X, image y along +Z (top = -Z).
  return { buffer, width: crop.width / perUnit, height: crop.height / perUnit, pixels: [crop.width, crop.height] };
}

// Makes the tile repeat seamlessly: blend it with a copy shifted by half its width
// (weights 0 at the left/right edges, 1 in the middle), then the same vertically. The
// blend keeps the texture's contrast (variance-preserving weights). Seamless tiles also
// stay seamless when the map flips them at random per repeat.
function makePeriodic(image, width, height, band = 0.2) {
  const mean = [0, 1, 2].map((k) => { let s = 0; for (let i = k; i < image.length; i += 3) s += image[i]; return s / (image.length / 3); });
  const pass = (source, horizontal) => {
    const out = new Float32Array(source.length);
    const size = horizontal ? width : height;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const t = horizontal ? x : y;
      const w = Math.min(1, Math.min(t + 0.5, size - t - 0.5) / (band * size));
      const weight = w * w * (3 - 2 * w); // smoothstep
      const norm = Math.hypot(weight, 1 - weight);
      const sx = horizontal ? (x + (width >> 1)) % width : x;
      const sy = horizontal ? y : (y + (height >> 1)) % height;
      for (let k = 0; k < 3; k += 1) {
        const a = source[(y * width + x) * 3 + k] - mean[k];
        const b = source[(sy * width + sx) * 3 + k] - mean[k];
        out[(y * width + x) * 3 + k] = mean[k] + (a * weight + b * (1 - weight)) / norm;
      }
    }
    return out;
  };
  const result = pass(pass(image, true), false);
  return Uint8Array.from(result, (v) => Math.max(0, Math.min(255, Math.round(v))));
}

// ---- Pipeline --------------------------------------------------------------------------
let io;
async function buildLevel(sourceBuffer, level) {
  const doc = await io.readBinary(new Uint8Array(sourceBuffer));
  await doc.transform(dedup(), flatten(), join({ keepNamed: false }), weld());
  if (level.keep < 1 || level.ratio < 1) {
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) simplifyPrimitive(prim, level);
  }
  await doc.transform(prune());
  await compressTextures(doc, level.texture);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium", quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }));
  return { buffer: Buffer.from(await io.writeBinary(doc)), triangles: triangles(doc) };
}

async function optimize(name, sourceBuffer, { surface }) {
  const stem = name.replace(/\.glb$/i, "");
  // Remove this model's previous levels and surface tile (their number can change).
  for (const file of await readdir(LOD_DIR)) if (file.startsWith(`${stem}.lod`) || file.startsWith(`${stem}.surface.`)) await rm(path.join(LOD_DIR, file));
  const sourceDoc = await io.readBinary(new Uint8Array(sourceBuffer));
  const entry = {
    source: { sha256: sha256(sourceBuffer), bytes: sourceBuffer.length, triangles: triangles(sourceDoc) },
    box: modelBox(sourceDoc),
    lods: []
  };
  let previous = Infinity;
  for (const [index, spec] of LADDER.entries()) {
    const level = index === 0 ? { ...spec, texture: LOD0_MAX_TEXTURE } : spec;
    const built = await buildLevel(sourceBuffer, level);
    const last = index === LADDER.length - 1;
    if (index > 0 && built.triangles > previous * MIN_REDUCTION && !last) continue;
    if (index > 0 && built.triangles > previous * MIN_REDUCTION && last) break;
    const file = index === 0 ? name : `lod/${stem}.lod${index}.glb`;
    await writeFile(path.join(MODELS_DIR, file), built.buffer);
    entry.lods.push({ url: file, minPx: spec.minPx, triangles: built.triangles, bytes: built.buffer.length });
    if (index === 0) { entry.sha256 = sha256(built.buffer); entry.bytes = built.buffer.length; }
    previous = built.triangles;
  }
  // The coarsest level kept is used down to 0 px.
  entry.lods[entry.lods.length - 1].minPx = 0;
  if (surface) {
    const baked = await bakeSurface(sourceDoc);
    const file = `lod/${stem}.surface.webp`;
    await writeFile(path.join(MODELS_DIR, file), baked.buffer);
    // width/height: tile size in model units (Garden "surface_scale" converts to metres).
    entry.surface = { url: file, width: +baked.width.toFixed(4), height: +baked.height.toFixed(4), pixels: baked.pixels, bytes: baked.buffer.length };
  }
  return entry;
}

// Models used as ground surfaces by Garden.geojson ("surface_model").
async function surfaceModels() {
  try {
    const garden = JSON.parse(await readFile(path.join(root, "public/data/Garden.geojson"), "utf8"));
    return new Set(garden.features.map((f) => f.properties?.surface_model).filter(Boolean).map((url) => path.basename(String(url))));
  } catch { return new Set(); }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const only = args.filter((a) => !a.startsWith("--"));
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  await mkdir(LOD_DIR, { recursive: true });
  await mkdir(SOURCE_DIR, { recursive: true });
  const manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, "utf8")) : { version: 1, models: {} };
  const surfaces = await surfaceModels();
  const names = (await readdir(MODELS_DIR)).filter((file) => /\.glb$/i.test(file) && (!only.length || only.includes(file))).sort();

  for (const name of names) {
    const current = await readFile(path.join(MODELS_DIR, name));
    const known = manifest.models[name];
    const upToDate = known && known.sha256 === sha256(current);
    const sourcePath = path.join(SOURCE_DIR, name);
    if (upToDate && !force && (!surfaces.has(name) || known.surface)) { console.log(`= ${name}: up to date`); continue; }
    // A file that is not our own output is a new upload: it becomes the source.
    if (!upToDate) await copyFile(path.join(MODELS_DIR, name), sourcePath);
    if (!existsSync(sourcePath)) { console.warn(`! ${name}: no source in ${path.relative(root, sourcePath)}; skipped`); continue; }
    const source = await readFile(sourcePath);
    console.log(`> ${name}: ${(source.length / 1048576).toFixed(1)} MB source`);
    const entry = await optimize(name, source, { surface: surfaces.has(name) });
    manifest.models[name] = entry;
    for (const lod of entry.lods) console.log(`  ${lod.url.padEnd(34)} ${String(lod.triangles).padStart(7)} triangles  ${(lod.bytes / 1048576).toFixed(2).padStart(6)} MB  from ${lod.minPx} px`);
    if (entry.surface) console.log(`  ${entry.surface.url.padEnd(34)} ${entry.surface.pixels.join("x").padStart(9)} px tile   ${(entry.surface.bytes / 1048576).toFixed(2).padStart(6)} MB  (ground surface, ${entry.surface.width} x ${entry.surface.height} model units)`);
  }
  // Forget models that were deleted from public/models/.
  for (const name of Object.keys(manifest.models)) if (!existsSync(path.join(MODELS_DIR, name))) delete manifest.models[name];
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nManifest: ${path.relative(root, MANIFEST)} (${Object.keys(manifest.models).length} models)`);
}

main().catch((error) => { console.error(error); process.exit(1); });
