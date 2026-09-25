// Geometry and GLB output of a generated building model.
//
// Model frame (models3d.js convention): metres, Y up, the front (entrance side)
// faces +Z, the footprint rectangle is centred on the origin: X from -W/2 to W/2
// (front width), Z from -D/2 to D/2 (depth), the ground at Y = 0.
// Everything is ONE mesh with ONE material (one draw call on the map).
//
// Lighting: models3d.js lights each model with lights fixed in the model's own
// frame (ambient 1.5, directional 1.5 from (0, -70, 100) and 1 from (0, 70, 100)),
// so faces those lights do not reach would render dark. Each face's shade is baked
// into vertex colours so the building is lit like the map's extrusions (light from
// azimuth 205°, about 38° high) at its placed rotation, with an emissive lift from
// the same texture.
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import earcut from "earcut";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

export const EMISSIVE = 0.38;
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const LIGHT_1 = norm([0, -70, 100]), LIGHT_2 = norm([0, 70, 100]);
const irradiance = (n) => (1.5 + 1.5 * Math.max(0, dot(n, LIGHT_1)) + 1.0 * Math.max(0, dot(n, LIGHT_2))) / Math.PI;
const SUN = [Math.sin(205 * Math.PI / 180) * Math.cos(38 * Math.PI / 180), Math.cos(205 * Math.PI / 180) * Math.cos(38 * Math.PI / 180), Math.sin(38 * Math.PI / 180)];
export const Y = [0, 1, 0];

// A facade frame along a polygon edge (model XZ points A -> B, outward normal n):
// a runs along the facade from left to right seen from outside, d inwards.
export function edgeFrame(A, B, n) {
  const normal = [n[0], 0, n[1]];
  const right = cross(Y, normal);
  const origin = (B[0] - A[0]) * right[0] + (B[1] - A[1]) * right[2] > 0 ? A : B;
  return {
    S: Math.hypot(B[0] - A[0], B[1] - A[1]),
    n: normal,
    right,
    at: (a, y, d) => [origin[0] + right[0] * a - normal[0] * d, y, origin[1] + right[2] * a - normal[2] * d]
  };
}

// regions: name -> [x, y, w, h] atlas pixels; swatches: names of uniform regions
// (sampled 8 px inside their edges). W, D: footprint; rotation: placed yaw (degrees).
export function createMesh({ regions, swatches, atlasSize = 1024, W, D, rotation }) {
  const theta = rotation * Math.PI / 180;
  const toWorld = ([x, y, z]) => [x * Math.cos(theta) - z * Math.sin(theta), -(x * Math.sin(theta) + z * Math.cos(theta)), y];
  const shadeOf = (n, ao) => {
    const target = (n[1] < -0.5 ? 0.52 : 0.74 + 0.26 * Math.max(0, dot(toWorld(n), SUN))) * ao;
    return Math.max(0, Math.min(1, (target - EMISSIVE) / irradiance(n)));
  };
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  // Optional placement of the geometry inside the model (rotation about Y, then offset).
  let place = { cos: 1, sin: 0, offset: [0, 0, 0] };
  const moved = (p) => [p[0] * place.cos + p[2] * place.sin + place.offset[0], p[1] + place.offset[1], -p[0] * place.sin + p[2] * place.cos + place.offset[2]];
  const turned = (v) => [v[0] * place.cos + v[2] * place.sin, v[1], -v[0] * place.sin + v[2] * place.cos];

  function regionRect(region) {
    if (!regions[region]) throw new Error(`unknown atlas region ${region}`);
    let [rx, ry, rw, rh] = regions[region];
    if (swatches.includes(region)) { rx += 8; ry += 8; rw -= 16; rh -= 16; } else { rx += 0.5; ry += 0.5; rw -= 1; rh -= 1; }
    return [rx, ry, rw, rh];
  }

  // Vertices [{ p, uv }] (model coordinates, atlas UV 0..1) sharing normal n;
  // triangles as index triples into that list.
  function emit(vertices, n, ao, triangles) {
    const normal = turned(n);
    const shade = shadeOf(normal, ao);
    const base = positions.length / 3;
    for (const { p, uv } of vertices) { positions.push(...moved(p)); normals.push(...normal); uvs.push(...uv); colors.push(shade, shade, shade); }
    for (const t of triangles) indices.push(base + t[0], base + t[1], base + t[2]);
  }

  // One rectangle: centre, outward normal n, `right` direction (up = n x right), size
  // w x h, mapped onto an atlas region (sub = [u0, v0, u1, v1] of the region, v up).
  function rect(center, n, right, w, h, region, ao = 1, sub = [0, 0, 1, 1]) {
    if (w <= 1e-4 || h <= 1e-4) return;
    const up = cross(n, right);
    const bl = add(add(center, mul(right, -w / 2)), mul(up, -h / 2));
    const corners = [bl, add(bl, mul(right, w)), add(add(bl, mul(right, w)), mul(up, h)), add(bl, mul(up, h))];
    const [rx, ry, rw, rh] = regionRect(region);
    const uvAt = (s, t) => [(rx + (sub[0] + (sub[2] - sub[0]) * s) * rw) / atlasSize, (ry + rh - (sub[1] + (sub[3] - sub[1]) * t) * rh) / atlasSize];
    const cornerUv = [uvAt(0, 0), uvAt(1, 0), uvAt(1, 1), uvAt(0, 1)];
    emit(corners.map((p, i) => ({ p, uv: cornerUv[i] })), n, ao, [[0, 1, 2], [0, 2, 3]]);
  }

  // Any quad (4 points in order around it) facing roughly along n; uv: [s, t] per point
  // in 0..1 of the region (t up). The winding is chosen to face n.
  function face(points, n, region, ao = 1, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const [rx, ry, rw, rh] = regionRect(region);
    const e1 = [points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]];
    const e2 = [points[2][0] - points[0][0], points[2][1] - points[0][1], points[2][2] - points[0][2]];
    const order = dot(cross(e1, e2), n) >= 0 ? [[0, 1, 2], [0, 2, 3]] : [[0, 2, 1], [0, 3, 2]];
    emit(points.map((p, i) => ({ p, uv: [(rx + uv[i][0] * rw) / atlasSize, (ry + rh - uv[i][1] * rh) / atlasSize] })), norm(n), ao, order);
  }

  // Flat polygon (model XZ points, any shape, triangulated) at height y facing up
  // (or down with facing = -1); uv(x, z) -> [s, t] in 0..1 of the region.
  function polygon(points, y, region, ao = 1, uv = () => [0.5, 0.5], facing = 1) {
    const flat = points.flatMap((p) => [p[0], p[1]]);
    const tris = earcut(flat);
    const [rx, ry, rw, rh] = regionRect(region);
    const vertices = points.map(([x, z]) => { const [s, t] = uv(x, z); return { p: [x, y, z], uv: [(rx + s * rw) / atlasSize, (ry + rh - t * rh) / atlasSize] }; });
    const triangles = [];
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
      const [p0, p1, p2] = [points[a], points[b], points[c]];
      // Y of the triangle's normal: (p1 - p0) x (p2 - p0) in (x, y, z).
      const ny = (p1[1] - p0[1]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[1] - p0[1]);
      triangles.push(ny * facing > 0 ? [a, b, c] : [a, c, b]);
    }
    emit(vertices, [0, facing, 0], ao, triangles);
  }

  // Facade frames of the footprint rectangle's sides: a along the side (left to
  // right seen from outside), y up, d inwards (negative d: in front of the footprint).
  const SIDES = {
    front: { S: W, n: [0, 0, 1], right: [1, 0, 0], at: (a, y, d) => [-W / 2 + a, y, D / 2 - d] },
    back: { S: W, n: [0, 0, -1], right: [-1, 0, 0], at: (a, y, d) => [W / 2 - a, y, -D / 2 + d] },
    right: { S: D, n: [1, 0, 0], right: [0, 0, -1], at: (a, y, d) => [W / 2 - d, y, D / 2 - a] },
    left: { S: D, n: [-1, 0, 0], right: [0, 0, 1], at: (a, y, d) => [-W / 2 + d, y, -D / 2 + a] }
  };

  // Box in facade coordinates of a frame (a side name or an edgeFrame()).
  // faces: o(uter) i(nner) l r t(op) b(ottom).
  function fbox(side, [a0, a1], [y0, y1], [d0, d1], faces, region, ao = 1, subs = {}) {
    const s = typeof side === "string" ? SIDES[side] : side;
    const neg = (v) => mul(v, -1);
    const am = (a0 + a1) / 2, ym = (y0 + y1) / 2, dm = (d0 + d1) / 2;
    for (const face of faces) {
      const sub = subs[face];
      if (face === "o") rect(s.at(am, ym, d0), s.n, s.right, a1 - a0, y1 - y0, region, ao, sub);
      if (face === "i") rect(s.at(am, ym, d1), neg(s.n), neg(s.right), a1 - a0, y1 - y0, region, ao, sub);
      if (face === "l") { const n = neg(s.right); rect(s.at(a0, ym, dm), n, cross(Y, n), d1 - d0, y1 - y0, region, ao, sub); }
      if (face === "r") { const n = s.right; rect(s.at(a1, ym, dm), n, cross(Y, n), d1 - d0, y1 - y0, region, ao, sub); }
      if (face === "t") rect(s.at(am, y1, dm), Y, s.right, a1 - a0, d1 - d0, region, ao, sub);
      if (face === "b") rect(s.at(am, y0, dm), neg(Y), s.right, a1 - a0, d1 - d0, region, ao, sub);
    }
  }

  // Axis-aligned box in model coordinates (roof structures, masts).
  function box([x0, x1], [y0, y1], [z0, z1], faces, region, ao = 1) {
    const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    if (faces.includes("+z")) rect([c[0], c[1], z1], [0, 0, 1], [1, 0, 0], w, h, region, ao);
    if (faces.includes("-z")) rect([c[0], c[1], z0], [0, 0, -1], [-1, 0, 0], w, h, region, ao);
    if (faces.includes("+x")) rect([x1, c[1], c[2]], [1, 0, 0], [0, 0, -1], d, h, region, ao);
    if (faces.includes("-x")) rect([x0, c[1], c[2]], [-1, 0, 0], [0, 0, 1], d, h, region, ao);
    if (faces.includes("+y")) rect([c[0], y1, c[2]], Y, [1, 0, 0], w, d, region, ao);
    if (faces.includes("-y")) rect([c[0], y0, c[2]], [0, -1, 0], [1, 0, 0], w, d, region, ao);
  }

  const isEnd = (side) => side === "right" || side === "left"; // meets the front/back at the corners
  const span = (side, depth) => (isEnd(side) ? [depth, SIDES[side].S - depth] : [0, SIDES[side].S]);
  // Geometry emitted after this call is turned by `angle` (radians, about Y, from +X
  // towards -Z) and moved by `offset` inside the model.
  const setPlacement = (angle = 0, offset = [0, 0, 0]) => { place = { cos: Math.cos(angle), sin: Math.sin(angle), offset }; };

  // Writes the GLB: one mesh, one material (base colour + emissive from the atlas;
  // cutout: alpha-masked and double-sided, for see-through parts like iron gates),
  // Meshopt-compressed; the scene extras record the footprint box for the map's fit.
  async function write(file, { atlas, footprint, name, cutout = false }) {
    const doc = new Document();
    doc.createExtension(EXTTextureWebP).setRequired(true);
    const buffer = doc.createBuffer();
    const accessor = (array, type, normalized = false) => doc.createAccessor().setArray(array).setType(type).setNormalized(normalized).setBuffer(buffer);
    const primitive = doc.createPrimitive()
      .setAttribute("POSITION", accessor(new Float32Array(positions), "VEC3"))
      .setAttribute("NORMAL", accessor(new Float32Array(normals), "VEC3"))
      .setAttribute("TEXCOORD_0", accessor(new Float32Array(uvs), "VEC2"))
      .setAttribute("COLOR_0", accessor(new Uint8Array(colors.map((c) => Math.round(c * 255))), "VEC3", true))
      .setIndices(accessor(new Uint32Array(indices), "SCALAR"));
    const texture = doc.createTexture(`${name}-atlas`).setImage(atlas).setMimeType("image/webp");
    const material = doc.createMaterial(`${name} facade`)
      .setBaseColorTexture(texture)
      .setEmissiveTexture(texture)
      .setEmissiveFactor([EMISSIVE, EMISSIVE, EMISSIVE])
      .setMetallicFactor(0)
      .setRoughnessFactor(0.92);
    if (cutout) material.setAlphaMode("MASK").setAlphaCutoff(0.5).setDoubleSided(true);
    material.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071); // CLAMP_TO_EDGE: atlas
    material.getEmissiveTextureInfo().setWrapS(33071).setWrapT(33071);
    primitive.setMaterial(material);
    const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive));
    doc.createScene(name).addChild(node).setExtras({ bcsir_footprint: footprint });
    doc.getRoot().getAsset().generator = "scripts/build-building-models.mjs";
    await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium", quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }));
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
    await mkdir(path.dirname(file), { recursive: true });
    await io.write(file, doc);
    return { triangles: indices.length / 3, vertices: positions.length / 3, bytes: (await stat(file)).size };
  }

  return { rect, face, polygon, fbox, box, SIDES, isEnd, span, setPlacement, write };
}
