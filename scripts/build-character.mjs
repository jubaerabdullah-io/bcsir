#!/usr/bin/env node
// Usage: npm run models:character
//
// Builds public/models/characters/male.glb, the walker shown in Walk Mode's
// third-person view (src/walk-character.js): a lightweight low-poly man (about
// 600 triangles, 1.75 m tall, feet at the origin, facing +Z, Y up, metres) on a
// 17-bone skeleton, with three looping animations and a jump pose:
//   Idle  breathing, arms at rest              (3 s)
//   Walk  leg and arm swing, 2 m/s pace       (0.8 s per two steps)
//   Run   bigger swing, bent elbows, lean     (0.6 s per two steps, 4.3 m/s pace)
//   Jump  knees drawn up, arms raised           (held while in the air)
// Every body part is a rigid, tapered box (or a rounded head) bound to one bone.
// Materials are named Skin, Hair, Shirt, Trousers and Shoes, so the map recolours
// them for each character (WALK_CHARACTERS in src/config.js). Any other GLB with
// animations named Idle, Walk and Run (and optionally those materials) can replace it.
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";

const root = fileURLToPath(new URL("..", import.meta.url));
const OUTPUT = path.join(root, "public/models/characters/male.glb");

// ---- Skeleton (rest pose: no rotation; translations relative to the parent) ----------
const BONES = [
  ["Hips", null, [0, 0.98, 0]],
  ["Spine", "Hips", [0, 0.1, 0]],
  ["Chest", "Spine", [0, 0.22, 0]],
  ["Neck", "Chest", [0, 0.26, 0]],
  ["Head", "Neck", [0, 0.08, 0]],
  ["UpperArm.L", "Chest", [0.21, 0.2, 0]],
  ["LowerArm.L", "UpperArm.L", [0, -0.29, 0]],
  ["Hand.L", "LowerArm.L", [0, -0.26, 0]],
  ["UpperArm.R", "Chest", [-0.21, 0.2, 0]],
  ["LowerArm.R", "UpperArm.R", [0, -0.29, 0]],
  ["Hand.R", "LowerArm.R", [0, -0.26, 0]],
  ["UpperLeg.L", "Hips", [0.1, -0.06, 0]],
  ["LowerLeg.L", "UpperLeg.L", [0, -0.44, 0]],
  ["Foot.L", "LowerLeg.L", [0, -0.42, 0]],
  ["UpperLeg.R", "Hips", [-0.1, -0.06, 0]],
  ["LowerLeg.R", "UpperLeg.R", [0, -0.44, 0]],
  ["Foot.R", "LowerLeg.R", [0, -0.42, 0]]
];
const boneIndex = new Map(BONES.map(([name], i) => [name, i]));
const worldPos = new Map();
for (const [name, parent, t] of BONES) {
  const p = parent ? worldPos.get(parent) : [0, 0, 0];
  worldPos.set(name, [p[0] + t[0], p[1] + t[1], p[2] + t[2]]);
}

// ---- Geometry ------------------------------------------------------------------------
const MATERIALS = { Skin: [0.62, 0.42, 0.3], Hair: [0.08, 0.06, 0.05], Shirt: [0.2, 0.42, 0.7], Trousers: [0.16, 0.17, 0.2], Shoes: [0.07, 0.07, 0.07], Eyes: [0.05, 0.05, 0.06] };
const parts = Object.fromEntries(Object.keys(MATERIALS).map((name) => [name, { positions: [], normals: [], joints: [], indices: [] }]));

function quad(part, bone, a, b, c, d) {
  const g = parts[part];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1; n = n.map((x) => x / l);
  const base = g.positions.length / 3;
  for (const p of [a, b, c, d]) { g.positions.push(...p); g.normals.push(...n); g.joints.push(boneIndex.get(bone), 0, 0, 0); }
  g.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Tapered box: centre x/z, from y0 (bottom size w0 x d0) to y1 (top size w1 x d1).
function taper(part, bone, [cx, cz], y0, y1, [w0, d0], [w1, d1], dz = [0, 0]) {
  const b = (w, d, y, oz) => [[cx - w / 2, y, cz - d / 2 + oz], [cx + w / 2, y, cz - d / 2 + oz], [cx + w / 2, y, cz + d / 2 + oz], [cx - w / 2, y, cz + d / 2 + oz]];
  const lo = b(w0, d0, y0, dz[0]), hi = b(w1, d1, y1, dz[1]);
  quad(part, bone, lo[3], lo[2], hi[2], hi[3]); // front (+z)
  quad(part, bone, lo[1], lo[0], hi[0], hi[1]); // back
  quad(part, bone, lo[2], lo[1], hi[1], hi[2]); // +x
  quad(part, bone, lo[0], lo[3], hi[3], hi[0]); // -x
  quad(part, bone, hi[3], hi[2], hi[1], hi[0]); // top
  quad(part, bone, lo[0], lo[1], lo[2], lo[3]); // bottom
}
const box = (part, bone, [cx, cy, cz], [w, h, d]) => taper(part, bone, [cx, cz], cy - h / 2, cy + h / 2, [w, d], [w, d]);

// Rounded head: a low-poly ellipsoid (only the part above `cutY` for the hair cap).
function ellipsoid(part, bone, [cx, cy, cz], [rx, ry, rz], { rings = 7, segments = 10, from = 0, to = 1 } = {}) {
  const at = (i, j) => {
    const theta = (i / rings) * Math.PI, phi = (j / segments) * Math.PI * 2;
    return [cx + rx * Math.sin(theta) * Math.sin(phi), cy + ry * Math.cos(theta), cz + rz * Math.sin(theta) * Math.cos(phi)];
  };
  for (let i = Math.floor(from * rings); i < Math.ceil(to * rings); i += 1) for (let j = 0; j < segments; j += 1) quad(part, bone, at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), at(i, j));
}

// Legs and shoes.
for (const [s, side] of [[1, "L"], [-1, "R"]]) {
  const hip = worldPos.get(`UpperLeg.${side}`), knee = worldPos.get(`LowerLeg.${side}`), ankle = worldPos.get(`Foot.${side}`);
  taper("Trousers", `UpperLeg.${side}`, [hip[0], 0], knee[1] + 0.02, hip[1] + 0.04, [0.13, 0.14], [0.16, 0.17]);
  taper("Trousers", `LowerLeg.${side}`, [knee[0], 0], ankle[1] + 0.02, knee[1] + 0.02, [0.105, 0.115], [0.13, 0.14]);
  box("Shoes", `Foot.${side}`, [ankle[0], 0.045, 0.045], [0.11, 0.09, 0.26]);
  // Arms: sleeve, forearm, hand.
  const shoulder = worldPos.get(`UpperArm.${side}`), elbow = worldPos.get(`LowerArm.${side}`), wrist = worldPos.get(`Hand.${side}`);
  taper("Shirt", `UpperArm.${side}`, [shoulder[0] + s * 0.01, 0], elbow[1], shoulder[1] + 0.03, [0.09, 0.09], [0.11, 0.11]);
  taper("Skin", `LowerArm.${side}`, [elbow[0], 0], wrist[1], elbow[1], [0.065, 0.07], [0.08, 0.085]);
  box("Skin", `Hand.${side}`, [wrist[0], wrist[1] - 0.05, 0.005], [0.07, 0.1, 0.045]);
}
// Pelvis, abdomen, chest (tapered to the shoulders), neck.
box("Trousers", "Hips", [0, 0.96, 0], [0.34, 0.16, 0.2]);
taper("Shirt", "Spine", [0, 0], 1.02, 1.2, [0.33, 0.2], [0.34, 0.2]);
taper("Shirt", "Chest", [0, 0], 1.2, 1.52, [0.34, 0.2], [0.44, 0.22]);
box("Skin", "Neck", [0, 1.57, 0], [0.1, 0.1, 0.1]);
// Head, hair cap, eyes and nose.
const head = worldPos.get("Head");
ellipsoid("Skin", "Head", [0, head[1] + 0.1, 0.01], [0.095, 0.12, 0.105]);
ellipsoid("Hair", "Head", [0, head[1] + 0.115, -0.003], [0.102, 0.12, 0.112], { from: 0, to: 0.43 });
for (const s of [1, -1]) box("Eyes", "Head", [s * 0.035, head[1] + 0.11, 0.108], [0.022, 0.014, 0.01]);
box("Skin", "Head", [0, head[1] + 0.08, 0.112], [0.024, 0.04, 0.03]);

// ---- Animations ----------------------------------------------------------------------
const quat = ([x, y, z]) => { // Euler XYZ (radians) -> quaternion [x, y, z, w]
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x / 2), Math.sin(x / 2), Math.cos(y / 2), Math.sin(y / 2), Math.cos(z / 2), Math.sin(z / 2)];
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
};
const pos = (x) => Math.max(0, x);
// Each clip: duration, samples, and per bone a function of the phase p (0..2π) -> Euler.
const CLIPS = {
  Idle: {
    duration: 3, samples: 25,
    hips: (p) => [0, 0.98 + 0.004 * Math.sin(p), 0],
    bones: {
      Chest: (p) => [0.03 * Math.sin(p), 0, 0],
      Head: (p) => [0.02 * Math.sin(p + 1), 0.06 * Math.sin(p / 1), 0],
      "UpperArm.L": (p) => [0.03 * Math.sin(p), 0, 0.07 + 0.015 * Math.sin(p)],
      "UpperArm.R": (p) => [0.03 * Math.sin(p), 0, -0.07 - 0.015 * Math.sin(p)],
      "LowerArm.L": () => [-0.12, 0, 0],
      "LowerArm.R": () => [-0.12, 0, 0]
    }
  },
  Walk: {
    duration: 0.8, samples: 17,
    hips: (p) => [0, 0.975 + 0.022 * Math.cos(2 * p), 0],
    bones: {
      Hips: (p) => [0, 0.08 * Math.sin(p), 0],
      Spine: () => [0.04, 0, 0],
      Chest: (p) => [0, -0.12 * Math.sin(p), 0],
      Head: (p) => [-0.03, 0.05 * Math.sin(p), 0],
      "UpperLeg.L": (p) => [-0.45 * Math.sin(p), 0, 0],
      "UpperLeg.R": (p) => [0.45 * Math.sin(p), 0, 0],
      "LowerLeg.L": (p) => [0.08 + 0.6 * pos(Math.cos(p)) ** 1.4, 0, 0],
      "LowerLeg.R": (p) => [0.08 + 0.6 * pos(-Math.cos(p)) ** 1.4, 0, 0],
      "Foot.L": (p) => [-0.2 * pos(Math.cos(p)), 0, 0],
      "Foot.R": (p) => [-0.2 * pos(-Math.cos(p)), 0, 0],
      "UpperArm.L": (p) => [0.38 * Math.sin(p), 0, 0.07],
      "UpperArm.R": (p) => [-0.38 * Math.sin(p), 0, -0.07],
      "LowerArm.L": (p) => [-0.25 - 0.12 * pos(-Math.sin(p)), 0, 0],
      "LowerArm.R": (p) => [-0.25 - 0.12 * pos(Math.sin(p)), 0, 0]
    }
  },
  Run: {
    duration: 0.6, samples: 17,
    hips: (p) => [0, 0.95 + 0.05 * Math.cos(2 * p), 0],
    bones: {
      Hips: (p) => [0, 0.12 * Math.sin(p), 0],
      Spine: () => [0.18, 0, 0],
      Chest: (p) => [0, -0.18 * Math.sin(p), 0],
      Head: () => [-0.15, 0, 0],
      "UpperLeg.L": (p) => [-0.8 * Math.sin(p) - 0.1, 0, 0],
      "UpperLeg.R": (p) => [0.8 * Math.sin(p) - 0.1, 0, 0],
      "LowerLeg.L": (p) => [0.2 + 1.3 * pos(Math.cos(p)) ** 1.2, 0, 0],
      "LowerLeg.R": (p) => [0.2 + 1.3 * pos(-Math.cos(p)) ** 1.2, 0, 0],
      "Foot.L": (p) => [-0.35 * pos(Math.cos(p)), 0, 0],
      "Foot.R": (p) => [-0.35 * pos(-Math.cos(p)), 0, 0],
      "UpperArm.L": (p) => [0.75 * Math.sin(p), 0, 0.1],
      "UpperArm.R": (p) => [-0.75 * Math.sin(p), 0, -0.1],
      "LowerArm.L": () => [-1.25, 0, 0],
      "LowerArm.R": () => [-1.25, 0, 0]
    }
  },
  // Held while in the air (Space in Walk Mode): knees drawn up, arms raised.
  Jump: {
    duration: 1, samples: 2,
    hips: () => [0, 0.93, 0],
    bones: {
      Spine: () => [0.12, 0, 0],
      Head: () => [-0.1, 0, 0],
      "UpperLeg.L": () => [-0.9, 0, 0],
      "LowerLeg.L": () => [1.3, 0, 0],
      "UpperLeg.R": () => [-0.3, 0, 0],
      "LowerLeg.R": () => [0.9, 0, 0],
      "Foot.L": () => [-0.3, 0, 0],
      "UpperArm.L": () => [-0.9, 0, 0.35],
      "UpperArm.R": () => [-0.9, 0, -0.35],
      "LowerArm.L": () => [-0.7, 0, 0],
      "LowerArm.R": () => [-0.7, 0, 0]
    }
  }
};

// ---- glTF document -------------------------------------------------------------------
const doc = new Document();
const buffer = doc.createBuffer();
const accessor = (array, type) => doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
const scene = doc.createScene("Walker");
const nodes = new Map();
for (const [name, parent, t] of BONES) {
  const node = doc.createNode(name).setTranslation(t);
  nodes.set(name, node);
  (parent ? nodes.get(parent) : scene).addChild(node);
}
const skin = doc.createSkin("Walker")
  .setSkeleton(nodes.get("Hips"))
  .setInverseBindMatrices(accessor(new Float32Array(BONES.flatMap(([name]) => { const p = worldPos.get(name); return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1]; })), "MAT4"));
for (const [name] of BONES) skin.addJoint(nodes.get(name));

const mesh = doc.createMesh("Walker");
let triangles = 0;
for (const [name, color] of Object.entries(MATERIALS)) {
  const g = parts[name];
  if (!g.indices.length) continue;
  const material = doc.createMaterial(name).setBaseColorFactor([...color, 1]).setMetallicFactor(0).setRoughnessFactor(name === "Hair" ? 0.6 : 0.85);
  mesh.addPrimitive(doc.createPrimitive()
    .setAttribute("POSITION", accessor(new Float32Array(g.positions), "VEC3"))
    .setAttribute("NORMAL", accessor(new Float32Array(g.normals), "VEC3"))
    .setAttribute("JOINTS_0", accessor(new Uint8Array(g.joints), "VEC4"))
    .setAttribute("WEIGHTS_0", accessor(new Float32Array(g.joints.map((_, i) => (i % 4 === 0 ? 1 : 0))), "VEC4"))
    .setIndices(accessor(new Uint16Array(g.indices), "SCALAR"))
    .setMaterial(material));
  triangles += g.indices.length / 3;
}
scene.addChild(doc.createNode("WalkerMesh").setMesh(mesh).setSkin(skin));

for (const [clipName, clip] of Object.entries(CLIPS)) {
  const animation = doc.createAnimation(clipName);
  const times = new Float32Array(Array.from({ length: clip.samples }, (_, i) => (i / (clip.samples - 1)) * clip.duration));
  const input = accessor(times, "SCALAR");
  const phase = (i) => (i / (clip.samples - 1)) * Math.PI * 2;
  const channel = (node, pathName, values, type) => {
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(accessor(new Float32Array(values), type)).setInterpolation("LINEAR");
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(pathName).setSampler(sampler));
  };
  channel(nodes.get("Hips"), "translation", Array.from({ length: clip.samples }, (_, i) => clip.hips(phase(i))).flat(), "VEC3");
  for (const [name] of BONES) {
    const fn = clip.bones[name] || (() => [0, 0, 0]);
    channel(nodes.get(name), "rotation", Array.from({ length: clip.samples }, (_, i) => quat(fn(phase(i)))).flat(), "VEC4");
  }
}
doc.getRoot().getAsset().generator = "scripts/build-character.mjs";

await mkdir(path.dirname(OUTPUT), { recursive: true });
await new NodeIO().write(OUTPUT, doc);
console.log(`Wrote ${path.relative(root, OUTPUT)}: ${triangles} triangles, ${BONES.length} bones, animations ${Object.keys(CLIPS).join(", ")}, ${((await stat(OUTPUT)).size / 1024).toFixed(0)} KB`);
