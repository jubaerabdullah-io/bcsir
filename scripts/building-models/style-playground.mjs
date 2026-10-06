// "playground" style: the BCSIR Play Ground (reference photos
// backup/models/source/playground/). Built on the footprint rectangle, at ground level:
//   - a grass football field, laid in cells of about 8 m of one seamless grass texture
//     or a variant of it (a dry or a lush patch fading out before the cell's edges, so
//     any cells join); worn, bare patches in the goal mouths and the centre;
//   - a brick edging round the field;
//   - a red-brown earth track round it on the long sides and the west end, with a low
//     plastered wall at the footprint's edge (a gap in the middle of each long side);
//   - concrete pavers with a circle pattern along the east end (where photo 3 was
//     taken), open to the walkway;
//   - a goal at each end: black-and-white striped posts and crossbar, a white net on a
//     thin white frame (cut-out texture).
// The footprint box is top_m - base_m high (0.3 m); the goals and the wall stand above
// it at their real height, so keep top_m (or rebuild after changing it).
import { hash, mix, scale } from "./atlas.mjs";
import { worldBearing } from "./polygon.mjs";

// Regions tile (they are repeated cell by cell) and are surrounded by more of the same,
// so the smaller mipmaps seen from a distance blend in nothing else.
export const regions = {
  grass: [32, 32, 256, 256],
  worn: [352, 32, 256, 256],
  dry: [672, 32, 256, 256],
  lush: [32, 352, 256, 256],
  paving: [352, 352, 192, 192],
  net: [608, 352, 192, 192],
  postStripes: [848, 336, 32, 256],
  barStripes: [912, 336, 96, 32],
  track: [32, 672, 384, 128],
  plaster: [464, 656, 64, 64],
  cap: [560, 656, 64, 64],
  brick: [656, 656, 64, 64],
  white: [752, 656, 64, 64],
  soil: [848, 656, 64, 64]
};
const PAD = { grass: 32, worn: 32, dry: 32, lush: 32, track: 32, paving: 32, postStripes: 16, barStripes: 16, net: 32 };
const SWATCH = { plaster: [218, 198, 176], cap: [200, 192, 180], brick: [150, 78, 56], white: [238, 238, 234], soil: [150, 104, 70] };
export const swatches = Object.keys(SWATCH);

const TRACK_WIDTH = 2.5, WALL = 0.25, KERB = 0.15;
const BAND = WALL + TRACK_WIDTH + KERB; // footprint edge to the grass
const CELL = 8; // grass cell (m)
const GOAL = { width: 5, height: 2.2, bar: 0.12, depth: 1.2, inset: 1.6 };
const NET_CELL = 1.25; // metres covered by the net region
const PAVING_CELL = 2.9; // metres covered by the paving region
const TRACK_CELL = 8; // metres of track per repeat

// ---- Texture -------------------------------------------------------------------------
// Value noise repeating every pw x ph pixels (ph Infinity: not across rows).
function tileNoise(x, y, cell, seed, pw, ph = Infinity) {
  const nx = Math.max(1, Math.round(pw / cell)), ny = Number.isFinite(ph) ? Math.max(1, Math.round(ph / cell)) : 0;
  const gx = x / (pw / nx), gy = y / (ny ? ph / ny : cell);
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (i, j) => hash(((i % nx) + nx) % nx, ny ? ((j % ny) + ny) % ny : j, seed);
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Paints a region and its margin: fn(x, y, w, h) in region pixels, wrapping (or, when
// not, clamped) into the region.
function paintRegion(atlas, name, fn, { wrapX = true, wrapY = true } = {}) {
  const [x0, y0, w, h] = regions[name], pad = PAD[name] ?? 16;
  const fold = (v, n, wrap) => (wrap ? ((v % n) + n) % n : Math.max(0, Math.min(n - 1, v)));
  atlas.paint([x0 - pad, y0 - pad, w + 2 * pad, h + 2 * pad], (px, py) => fn(fold(px - pad, w, wrapX), fold(py - pad, h, wrapY), w, h));
}

// Plain grass: little contrast at the cell's scale, so the repeat does not show.
function grassAt(x, y, w, h) {
  const n = tileNoise(x, y, 64, 11, w, h) * 0.35 + tileNoise(x, y, 16, 12, w, h) * 0.65;
  let c = mix([82, 130, 50], [108, 152, 60], n);
  const blade = hash(x, y, 14);
  c = scale(c, 0.95 + blade * 0.1);
  if (blade > 0.985) c = mix(c, [176, 196, 110], 0.4); // sunlit blades
  return c;
}

// A patch in the middle of the cell, fading to plain grass well before its edges, so
// every variant joins every other one. strength(u, v, x, y) in 0..1, u and v from -0.5 to 0.5.
function patchAt(x, y, w, h, colour, strength) {
  const grass = grassAt(x, y, w, h);
  const u = (x + 0.5) / w - 0.5, v = (y + 0.5) / h - 0.5;
  const fade = Math.max(0, Math.min(1, (0.46 - Math.max(Math.abs(u), Math.abs(v))) / 0.12));
  const k = Math.max(0, Math.min(1, strength(u, v, x, y))) * fade;
  return k > 0 ? mix(grass, colour(x, y), k) : grass;
}
// Irregular blob of about `size` round (du, dv) off the cell's centre (the cells are
// mirrored at random, so an off-centre blob lands in four places).
const blob = (u, v, x, y, w, h, seed, size, du = 0, dv = 0) => (1 - Math.hypot((u - du) * 1.3, v - dv) / size + (tileNoise(x, y, 40, seed, w, h) - 0.5) * 0.9) * 1.5;

// Bare, trodden soil (goal mouths, the centre): dusty light brown as in photo 3.
const wornAt = (x, y, w, h) => {
  const soil = (px, py) => scale(mix([150, 128, 96], [178, 156, 118], tileNoise(px, py, 18, 22, w, h)), 0.95 + hash(px, py, 23) * 0.1);
  const out = patchAt(x, y, w, h, soil, (u, v) => blob(u, v, x, y, w, h, 21, 0.38));
  return hash(x, y, 24) > 0.85 ? grassAt(x, y, w, h) : out; // tufts left standing
};
const dryAt = (x, y, w, h) => patchAt(x, y, w, h, (px, py) => scale([140, 148, 76], 0.95 + hash(px, py, 25) * 0.1), (u, v) => blob(u, v, x, y, w, h, 26, 0.5, 0.12, -0.1) * 0.5);
const lushAt = (x, y, w, h) => patchAt(x, y, w, h, (px, py) => scale([68, 116, 44], 0.95 + hash(px, py, 27) * 0.1), (u, v) => blob(u, v, x, y, w, h, 28, 0.55, -0.1, 0.12) * 0.45);

function trackAt(x, y, w) {
  let c = mix([160, 86, 54], [188, 112, 72], tileNoise(x, y, 40, 31, w) * 0.7 + tileNoise(x, y, 12, 32, w) * 0.3);
  c = mix(c, [206, 150, 110], Math.max(0, tileNoise(x, y, 70, 33, w) - 0.6) * 1.4); // dusty
  const g = hash(x, y, 34);
  c = scale(c, 0.95 + g * 0.1);
  if (g > 0.985) c = [96, 64, 48]; // grit
  return c;
}

// Square pavers (7 across the region) with a circle groove round each corner.
function pavingAt(x, y, w) {
  const n = 7, size = w / n;
  const i = Math.floor(x / size), j = Math.floor(y / size);
  const fx = x - i * size, fy = y - j * size;
  if (fx < 1.5 || fy < 1.5) return [118, 112, 108]; // joints
  const base = mix([172, 150, 142], [150, 148, 146], hash(((i % n) + n) % n, ((j % n) + n) % n, 41));
  let c = scale(base, 0.94 + hash(x, y, 42) * 0.1);
  for (const [cx, cy] of [[0, 0], [size, 0], [0, size], [size, size]]) if (Math.abs(Math.hypot(fx - cx, fy - cy) - size * 0.42) < 1) c = scale(c, 0.82);
  return c;
}

export async function paint(atlas) {
  paintRegion(atlas, "grass", grassAt);
  paintRegion(atlas, "worn", wornAt);
  paintRegion(atlas, "dry", dryAt);
  paintRegion(atlas, "lush", lushAt);
  paintRegion(atlas, "track", trackAt, { wrapY: false });
  paintRegion(atlas, "paving", pavingAt);
  // Stripes: 0.3 m bands along the 2.3 m post and the 5.12 m crossbar.
  paintRegion(atlas, "postStripes", (x, y, w, h) => (Math.floor(((1 - (y + 0.5) / h) * (GOAL.height + GOAL.bar)) / 0.3) % 2 ? [236, 236, 232] : [34, 34, 36]), { wrapY: false });
  paintRegion(atlas, "barStripes", (x, y, w) => (Math.floor((((x + 0.5) / w) * (GOAL.width + 2 * GOAL.bar)) / 0.3) % 2 ? [236, 236, 232] : [34, 34, 36]), { wrapX: false });
  // Net: about 20 cm mesh of thick white cord (it thins out cleanly with distance);
  // transparent between (alpha 0).
  paintRegion(atlas, "net", (x, y, w) => {
    const mesh = w / 6;
    return (x % mesh) < 4 || (y % mesh) < 4 ? [238, 238, 234, 255] : [238, 238, 234, 0];
  });
  for (const [name, color] of Object.entries(SWATCH)) {
    const [x0, y0, w, h] = regions[name];
    atlas.paint([x0 - 16, y0 - 16, w + 32, h + 32], (x, y) => scale(color, 1 + (hash(x, y, 60) - 0.5) * 0.04));
  }
}

// ---- Geometry ------------------------------------------------------------------------
export function build(mesh, { W, D, rotation }) {
  const { rect, box } = mesh;
  const Y = [0, 1, 0];
  const flat = (x0, x1, z0, z1, y, region, sub) => rect([(x0 + x1) / 2, y, (z0 + z1) / 2], Y, [1, 0, 0], x1 - x0, z1 - z0, region, 1, sub);
  // Horizontal strip cut in pieces of about `cell` metres along its long side.
  const strip = (x0, x1, z0, z1, y, region, cell) => {
    const alongX = x1 - x0 >= z1 - z0;
    const L = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(L / cell));
    for (let i = 0; i < n; i += 1) {
      if (alongX) flat(x0 + (L * i) / n, x0 + (L * (i + 1)) / n, z0, z1, y, region);
      else rect([(x0 + x1) / 2, y, z0 + (L * (i + 0.5)) / n], Y, [0, 0, 1], L / n, x1 - x0, region, 1);
    }
  };

  // Which end is east: the model's +X faces worldBearing([1, 0]).
  const eastSign = Math.sin(worldBearing([1, 0], rotation) * Math.PI / 180) > 0 ? 1 : -1;
  const hx = W / 2, hz = D / 2;
  const [gx0, gx1, gz0, gz1] = [-hx + BAND, hx - BAND, -hz + BAND, hz - BAND]; // the grass

  // Grass cells: worn in the goal mouths and the centre; elsewhere plain, or with a dry
  // or a lush patch, picked and mirrored at random (the same every build), so the
  // repeat does not show.
  const nx = Math.max(3, Math.round((gx1 - gx0) / CELL)), nz = Math.max(2, Math.round((gz1 - gz0) / CELL));
  const cw = (gx1 - gx0) / nx, cd = (gz1 - gz0) / nz;
  const middleRows = nz % 2 ? [(nz - 1) / 2] : [nz / 2 - 1, nz / 2];
  const middleCols = nx % 2 ? [(nx - 1) / 2] : [nx / 2 - 1, nx / 2];
  for (let i = 0; i < nx; i += 1) for (let k = 0; k < nz; k += 1) {
    const worn = middleRows.includes(k) && (i === 0 || i === nx - 1 || middleCols.includes(i));
    const r = hash(i, k, 77);
    const region = worn ? "worn" : r < 0.2 ? "dry" : r < 0.4 ? "lush" : "grass";
    const [fu, fv] = [hash(i, k, 78) > 0.5 ? 1 : 0, hash(i, k, 79) > 0.5 ? 1 : 0];
    flat(gx0 + i * cw, gx0 + (i + 1) * cw, gz0 + k * cd, gz0 + (k + 1) * cd, 0.035, region, [fu, fv, 1 - fu, 1 - fv]);
  }

  // Brick edging round the grass.
  box([gx0 - KERB, gx1 + KERB], [0, 0.1], [gz1, gz1 + KERB], "+y +z -z", "brick", 1);
  box([gx0 - KERB, gx1 + KERB], [0, 0.1], [gz0 - KERB, gz0], "+y +z -z", "brick", 1);
  box([gx1, gx1 + KERB], [0, 0.1], [gz0, gz1], "+y +x -x", "brick", 1);
  box([gx0 - KERB, gx0], [0, 0.1], [gz0, gz1], "+y +x -x", "brick", 1);

  // Pavers along the east end; the track on the long sides (to the west corners) and
  // along the west end.
  const east = eastSign > 0 ? [gx1 + KERB, hx] : [-hx, gx0 - KERB];
  const west = eastSign > 0 ? [-hx, gx0 - KERB] : [gx1 + KERB, hx];
  const longSides = eastSign > 0 ? [-hx, gx1 + KERB] : [gx0 - KERB, hx];
  strip(longSides[0], longSides[1], gz1 + KERB, hz, 0.025, "track", TRACK_CELL);
  strip(longSides[0], longSides[1], -hz, gz0 - KERB, 0.025, "track", TRACK_CELL);
  strip(west[0], west[1], gz0 - KERB, gz1 + KERB, 0.025, "track", TRACK_CELL);
  const pn = Math.max(1, Math.round(D / PAVING_CELL));
  for (let k = 0; k < pn; k += 1) flat(east[0], east[1], -hz + (D * k) / pn, -hz + (D * (k + 1)) / pn, 0.04, "paving");

  // Low plastered wall along the long sides (a 3 m gate in the middle of each) and the
  // west end; the east end is open to the walkway.
  const wall = (xs, zs) => {
    box(xs, [0, 0.5], zs, "+x -x +z -z", "plaster", 0.95);
    box([xs[0] - 0.03, xs[1] + 0.03], [0.5, 0.56], [zs[0] - 0.03, zs[1] + 0.03], "+x -x +z -z +y", "cap", 1);
  };
  for (const zs of [[hz - WALL, hz], [-hz, -hz + WALL]]) {
    wall([-hx, -1.5], zs);
    wall([1.5, hx], zs);
  }
  wall(eastSign > 0 ? [-hx, -hx + WALL] : [hx - WALL, hx], [-hz + WALL, hz - WALL]);

  // Goals: the goal line GOAL.inset inside each end of the grass, the net behind it.
  const post = (x, z) => {
    const s = GOAL.bar / 2, h = GOAL.height + GOAL.bar;
    rect([x, h / 2, z + s], [0, 0, 1], [1, 0, 0], GOAL.bar, h, "postStripes", 1);
    rect([x, h / 2, z - s], [0, 0, -1], [-1, 0, 0], GOAL.bar, h, "postStripes", 1);
    rect([x + s, h / 2, z], [1, 0, 0], [0, 0, -1], GOAL.bar, h, "postStripes", 1);
    rect([x - s, h / 2, z], [-1, 0, 0], [0, 0, 1], GOAL.bar, h, "postStripes", 1);
  };
  for (const side of [1, -1]) {
    const xg = side * (gx1 - GOAL.inset), xb = xg + side * GOAL.depth; // goal line, back of the net
    const hw = GOAL.width / 2, top = GOAL.height, s = GOAL.bar / 2;
    post(xg, -hw - s);
    post(xg, hw + s);
    // Crossbar: its faces carry the stripes along it.
    const bw = GOAL.width + 2 * GOAL.bar;
    rect([xg + s, top + s, 0], [1, 0, 0], [0, 0, -1], bw, GOAL.bar, "barStripes", 1);
    rect([xg - s, top + s, 0], [-1, 0, 0], [0, 0, 1], bw, GOAL.bar, "barStripes", 1);
    rect([xg, top + GOAL.bar, 0], Y, [0, 0, -1], bw, GOAL.bar, "barStripes", 1);
    rect([xg, top, 0], [0, -1, 0], [0, 0, 1], bw, GOAL.bar, "barStripes", 0.8);
    // Net frame: thin white tubes at the back and along the ground and the top.
    const tube = 0.05, [xa, xz] = [Math.min(xg, xb), Math.max(xg, xb)];
    for (const z of [-hw, hw]) {
      box([xb - tube / 2, xb + tube / 2], [0, top], [z - tube / 2, z + tube / 2], "+x -x +z -z", "white", 1);
      box([xa, xz], [top - tube, top], [z - tube / 2, z + tube / 2], "+z -z +y -y", "white", 1);
      box([xa, xz], [0.035, 0.035 + tube], [z - tube / 2, z + tube / 2], "+z -z +y", "white", 1);
    }
    box([xb - tube / 2, xb + tube / 2], [top - tube, top], [-hw, hw], "+x -x +y -y", "white", 1);
    box([xb - tube / 2, xb + tube / 2], [0.035, 0.035 + tube], [-hw, hw], "+x -x +y", "white", 1);
    // Net panels in cells of about NET_CELL metres (the material is double-sided).
    const cz = Math.round(GOAL.width / NET_CELL), cy = Math.round(top / NET_CELL);
    for (let i = 0; i < cz; i += 1) {
      const z = -hw + (GOAL.width * (i + 0.5)) / cz;
      for (let j = 0; j < cy; j += 1) rect([xb, (top * (j + 0.5)) / cy, z], [side, 0, 0], [0, 0, -side], GOAL.width / cz, top / cy, "net", 1);
      rect([(xg + xb) / 2, top, z], Y, [0, 0, 1], GOAL.width / cz, GOAL.depth, "net", 1);
    }
    for (const z of [-hw, hw]) for (let j = 0; j < cy; j += 1) rect([(xg + xb) / 2, (top * (j + 0.5)) / cy, z], [0, 0, Math.sign(z)], [Math.sign(z), 0, 0], GOAL.depth, top / cy, "net", 1);
  }
  return { facades: [`east end (pavers) is model ${eastSign > 0 ? "+X" : "-X"}; grass ${nx} x ${nz} cells of ${cw.toFixed(1)} x ${cd.toFixed(1)} m`] };
}
