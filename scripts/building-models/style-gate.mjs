// "gate" style: the BCSIR Main Gate (reference photos backup/models/source/main-gate/).
// A white arch block (two pillars with paired rounded-panel reliefs and grooves, a
// segmental arch, the attic with the Council's name and the ministry's in Bangla,
// a cornice), a see-through iron gate with an arched top, and on each side a lower
// wing: pedestrian gate, slim grooved pillar and a tile-clad wall with the round
// emblem under a flat roof slab.
// The BuildingBoundary feature is only a small marker, so the gate is not fitted
// to it: it is built at its real size (about 27.6 m wide) and stands on the campus
// boundary wall line next to the marker, turned along that wall with its front
// (the inscription) facing out of the campus. The marker's rectangle is recorded as
// the footprint box, so the map places the model at scale 1.
import { concrete, hash, mix } from "./atlas.mjs";

export const regions = {
  attic: [0, 0, 1024, 192],
  pillar: [0, 192, 192, 512],
  slim: [192, 192, 64, 256],
  gate: [256, 192, 512, 344],
  wall: [256, 544, 512, 280],
  fascia: [768, 192, 256, 64],
  white: [768, 272, 64, 64],
  trim: [832, 272, 64, 64],
  dark: [896, 272, 64, 64],
  tile: [960, 272, 64, 64]
};
const SWATCH = { white: [240, 240, 236], trim: [176, 182, 192], dark: [62, 66, 72], tile: [206, 170, 126] };
export const swatches = Object.keys(SWATCH);
const GROOVE = [92, 100, 116];

// ---- Texture -------------------------------------------------------------------------
async function paintAttic(atlas) {
  atlas.paint(regions.attic, (x, y, w, h) => {
    const v = y / h;
    if (v < 0.04 || v > 0.96) return [200, 204, 210];
    return concrete([242, 242, 238], x, y, 11, 2, 3);
  });
  await atlas.text(regions.attic, [
    { text: "বাংলাদেশ বিজ্ঞান ও শিল্প গবেষণা পরিষদ", height: 0.36, top: 0.1, color: "#4a4f5a", bold: true, maxWidth: 0.92 },
    { text: "বিজ্ঞান ও প্রযুক্তি মন্ত্রণালয়", height: 0.26, top: 0.58, color: "#4a4f5a", bold: true, maxWidth: 0.6 }
  ]);
}

// Pillar front (2 m x 5.3 m): grooves along the outer edge, two tall rounded panels high up.
function paintPillar(atlas) {
  const [, , w, h] = regions.pillar;
  const rounded = (u, v, u0, u1, v0, v1) => {
    const r = (u1 - u0) / 2, cu = (u0 + u1) / 2;
    const dy = v > v1 - r * (w / h) ? (v - (v1 - r * (w / h))) / (w / h) : v < v0 + r * (w / h) ? (v0 + r * (w / h) - v) / (w / h) : 0;
    const d = Math.hypot(u - cu, dy);
    return Math.abs(d - r) < 0.02 && v > v0 - 0.02 && v < v1 + 0.02 || (dy === 0 && v >= v0 && v <= v1 && Math.abs(Math.abs(u - cu) - r) < 0.02);
  };
  atlas.paint(regions.pillar, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete([242, 242, 238], x, y, 21, 2, 3);
    if (v < 0.94 && [0.06, 0.12].some((g) => Math.abs(u - g) < 0.012)) c = GROOVE;
    if (rounded(u, v, 0.3, 0.58, 0.58, 0.9) || rounded(u, v, 0.64, 0.92, 0.58, 0.9)) c = GROOVE;
    return c;
  });
}

function paintSlim(atlas) {
  const [, , w] = regions.slim;
  atlas.paint(regions.slim, (x, y) => {
    const u = x / w;
    return [0.3, 0.7].some((g) => Math.abs(u - g) < 0.05) ? GROOVE : concrete([242, 242, 238], x, y, 23, 2, 3);
  });
}

// Iron gate with an arched top: bars and rails on a transparent ground. The colour
// under the see-through pixels is the bars' own, so the gate stays dark at a distance.
function paintGate(atlas) {
  const [, , w, h] = regions.gate;
  const bar = [58, 60, 64];
  atlas.paint(regions.gate, (x, y) => {
    const u = x / w, metres = (1 - y / h) * 3.7;
    const top = 3.0 + 0.7 * Math.sqrt(Math.max(0, 1 - ((u - 0.5) / 0.5) ** 2));
    if (metres > top) return [...bar, 0];
    const solid = Math.abs((u * 46) % 1 - 0.5) > 0.36 // bars
      || [0.15, 1.05, 2.2].some((r) => Math.abs(metres - r) < 0.05) // rails
      || Math.abs(metres - (top - 0.06)) < 0.07 // top rail
      || Math.abs(u - 0.5) < 0.008 // leaves meet
      || (metres > 2.25 && metres < top - 0.1 && Math.abs(((u * 23) % 1) - 0.5 - (metres % 0.35) / 0.7) < 0.05); // lattice
    return solid ? bar : [...bar, 0];
  });
}

// Wing wall: stacked tiles with the round emblem (navy ring, red disc) in the middle.
function paintWall(atlas) {
  const [, , w, h] = regions.wall;
  const sx = w / 6.6, sy = h / 3.6;
  atlas.paint(regions.wall, (x, y) => {
    const mx = x / sx, my = 3.6 - y / sy;
    const tx = Math.floor(mx / 0.3), ty = Math.floor(my / 0.1);
    let c = (mx % 0.3) < 0.02 || (my % 0.1) < 0.012 ? [230, 216, 192] : mix([206, 170, 126], [188, 150, 108], hash(tx, ty, 31));
    if (my < 0.3) c = concrete([214, 212, 206], x, y, 33, 2, 3);
    const d = Math.hypot(mx - 3.3, my - 2.0);
    if (d < 0.65) c = d > 0.55 ? [36, 56, 120] : d > 0.5 ? [236, 236, 232] : [204, 42, 46];
    return c;
  });
}

export async function paint(atlas) {
  await paintAttic(atlas);
  paintPillar(atlas);
  paintSlim(atlas);
  paintGate(atlas);
  paintWall(atlas);
  atlas.paint(regions.fascia, (x, y, w, h) => (Math.abs(y / h - 0.7) < 0.06 ? [170, 176, 186] : concrete([242, 242, 238], x, y, 41, 2, 3)));
  for (const [name, color] of Object.entries(SWATCH)) atlas.paint(regions[name], (x, y) => concrete(color, x, y, 60, 2, 0));
}

// ---- Geometry ------------------------------------------------------------------------
// The gate is built in its own frame (X along the wall, +Z out of the campus) and
// placed on the wall line nearest the marker.
function wallPlacement(rings, outside) {
  let best = null;
  for (const ring of rings) for (let i = 1; i < ring.length; i += 1) {
    const [P, Q] = [ring[i - 1], ring[i]];
    const dx = Q[0] - P[0], dz = Q[1] - P[1], l2 = dx * dx + dz * dz;
    if (l2 < 1) continue;
    const t = Math.max(0, Math.min(1, -(P[0] * dx + P[1] * dz) / l2));
    const C = [P[0] + dx * t, P[1] + dz * t];
    const d = Math.hypot(...C);
    if (!best || d < best.d) best = { d, C, dir: [dx / Math.sqrt(l2), dz / Math.sqrt(l2)] };
  }
  if (!best || best.d > 15) return { angle: 0, offset: [0, 0, 0] };
  let angle = Math.atan2(-best.dir[1], best.dir[0]); // local +X along the wall
  const front = [Math.sin(angle), Math.cos(angle)]; // local +Z in the model
  if (!outside([best.C[0] + front[0] * 4, best.C[1] + front[1] * 4])) angle += Math.PI;
  return { angle, offset: [best.C[0], 0, best.C[1]], distance: best.d };
}

export function build(mesh, { H, boundaryRings = [], insideCampus = () => false }) {
  const { box, face, rect, setPlacement } = mesh;
  const place = wallPlacement(boundaryRings, (p) => !insideCampus(p));
  setPlacement(place.angle, place.offset);

  const top = H; // cornice top
  const attic0 = 5.3, attic1 = top - 0.35;
  const HALF = 4.8, PILLAR = 2.0, DEPTH = 1.3, SPRING = 4.2, CROWN = 5.1;
  const open = HALF - PILLAR;
  // Pillars (front/back faces with the relief, the right pillar mirrored).
  for (const sgn of [-1, 1]) {
    const x0 = sgn < 0 ? -HALF : open, x1 = sgn < 0 ? -open : HALF;
    const mirror = sgn > 0 ? [1, 0, 0, 1] : [0, 0, 1, 1];
    rect([(x0 + x1) / 2, attic0 / 2, DEPTH], [0, 0, 1], [1, 0, 0], PILLAR, attic0, "pillar", 1, mirror);
    rect([(x0 + x1) / 2, attic0 / 2, -DEPTH], [0, 0, -1], [-1, 0, 0], PILLAR, attic0, "pillar", 0.95, sgn > 0 ? [0, 0, 1, 1] : [1, 0, 0, 1]);
    box([x0, x1], [0, attic0], [-DEPTH, DEPTH], sgn < 0 ? "-x +x" : "+x -x", "white", 0.95);
  }
  // Attic with the inscription (front), plain at the back; cornice over it.
  box([-HALF, HALF], [attic0, attic1], [-DEPTH, DEPTH], "-z +x -x", "white", 0.95);
  rect([0, (attic0 + attic1) / 2, DEPTH], [0, 0, 1], [1, 0, 0], HALF * 2, attic1 - attic0, "attic", 1);
  box([-HALF - 0.25, HALF + 0.25], [attic1, top], [-DEPTH - 0.25, DEPTH + 0.25], "+z -z +x -x +y -y", "white", 1);
  box([-HALF - 0.25, HALF + 0.25], [attic1 - 0.08, attic1], [-DEPTH - 0.25, DEPTH + 0.25], "+z -z", "trim", 1);
  // Segmental arch: spandrels front and back, and its underside.
  const R = (open ** 2 + (CROWN - SPRING) ** 2) / (2 * (CROWN - SPRING)), cy = CROWN - R;
  const arch = (x) => cy + Math.sqrt(R * R - x * x);
  const N = 12;
  for (let i = 0; i < N; i += 1) {
    const x0 = -open + (2 * open * i) / N, x1 = -open + (2 * open * (i + 1)) / N;
    const [y0, y1] = [arch(x0), arch(x1)];
    face([[x0, y0, DEPTH], [x1, y1, DEPTH], [x1, attic0, DEPTH], [x0, attic0, DEPTH]], [0, 0, 1], "white", 1);
    face([[x0, y0, -DEPTH], [x1, y1, -DEPTH], [x1, attic0, -DEPTH], [x0, attic0, -DEPTH]], [0, 0, -1], "white", 0.95);
    const xm = (x0 + x1) / 2;
    face([[x0, y0, -DEPTH], [x1, y1, -DEPTH], [x1, y1, DEPTH], [x0, y0, DEPTH]], [-xm, cy - arch(xm), 0], "white", 0.8);
  }
  // Iron gate in the arch opening (see-through).
  rect([0, 1.85, 0], [0, 0, 1], [1, 0, 0], open * 2 - 0.1, 3.7, "gate", 1);

  // Wings: pedestrian gate, slim pillar, tile wall with the emblem, roof slab.
  const WING = 13.8, ROOF = [3.6, 4.0];
  for (const sgn of [-1, 1]) {
    const X = (a) => sgn * a;
    const span = (a, b) => [Math.min(X(a), X(b)), Math.max(X(a), X(b))];
    rect([X(5.7), 1.3, 0], [0, 0, 1], [1, 0, 0], 1.8, 2.6, "gate", 1, [0, 0, 0.33, 0.7]);
    box(span(6.6, 7.2), [0, ROOF[0]], [-0.45, 0.45], "+z -z +x -x", "slim", 1);
    rect([X(10.5), 1.8, 0.25], [0, 0, 1], [1, 0, 0], 6.6, 3.6, "wall", 1);
    rect([X(10.5), 1.8, -0.25], [0, 0, -1], [-1, 0, 0], 6.6, 3.6, "wall", 0.95);
    box(span(WING - 0.01, WING), [0, ROOF[0]], [-0.25, 0.25], sgn < 0 ? "-x" : "+x", "tile", 0.9);
    box(span(HALF, WING), ROOF, [-1.0, 1.0], "+y -y " + (sgn < 0 ? "-x" : "+x"), "white", 1);
    rect([X((HALF + WING) / 2), (ROOF[0] + ROOF[1]) / 2, 1.0], [0, 0, 1], [1, 0, 0], WING - HALF, ROOF[1] - ROOF[0], "fascia", 1);
    rect([X((HALF + WING) / 2), (ROOF[0] + ROOF[1]) / 2, -1.0], [0, 0, -1], [-1, 0, 0], WING - HALF, ROOF[1] - ROOF[0], "fascia", 0.95);
  }
  setPlacement();
  return place;
}
