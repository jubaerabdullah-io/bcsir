// "residential" style: the BCSIR residential quarters (reference photos
// backup/models/source/residential/). All quarters share one architecture, so this
// is ONE module, one bay of one floor, which the map tiles over every residential
// footprint (src/building-footprint.js tiledModelParts): bays along each strip of the
// stepped plan, floors stacked up to top_m.
//   front (+Z)  veranda side: a solid railing wall with the concrete jali lattice
//               above it, beside a green-framed window with a grille
//   back (-Z)   a wider green-framed window and a small bathroom vent
//   ends (±X)   plain plaster (seen at the block ends and where the plan steps)
// Pale yellow plaster; at the top of every floor a slab projecting all round with a
// green-painted edge (the top floor's is the roof edge); a parapet on the front and
// back of the dark, weathered roof. The parapet stays inside the wall planes, so the
// floor stacked above hides it; the slabs stop 3 cm under the floor above, so no two
// faces lie in one plane. The ends have no parapet: it would stand across the roof
// wherever two bays meet.
import { hash, mix, scale, valueNoise } from "./atlas.mjs";

// Every bay repeats these textures side by side, so the walls and the roof are
// periodic across their width, and each region is surrounded by more of the same
// (rows below the walls, a wide margin round the roof, blocks round the swatches):
// the smaller mipmaps seen from a distance then blend in nothing else.
export const regions = {
  front: [0, 0, 384, 400],
  back: [384, 0, 384, 400],
  end: [768, 0, 256, 400],
  roof: [128, 448, 256, 256],
  cream: [544, 480, 64, 64],
  slab: [672, 480, 64, 64],
  green: [800, 480, 64, 64],
  coping: [928, 480, 64, 64]
};
const PLASTER = [236, 226, 180];
const GREEN = [62, 140, 76];
const SWATCH = { cream: PLASTER, slab: [226, 218, 184], green: GREEN, coping: [228, 224, 206] };
export const swatches = Object.keys(SWATCH);

// ---- Texture -------------------------------------------------------------------------
// Value noise repeating every `period` pixels across (cells fitted to the period).
function periodic(x, y, cell, seed, period) {
  const n = Math.max(1, Math.round(period / cell)), size = period / n;
  const gx = x / size, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (i, j) => hash(((i % n) + n) % n, j, seed);
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Weathered plaster: grain, soft blotches, rain streaks, darker under the slab.
function plaster(x, y, w, h, seed) {
  const v = 1 - y / h;
  let k = 1 + (hash(x % w, y, seed) - 0.5) * 0.05 + (periodic(x, y, 40, seed + 1, w) - 0.5) * 0.08;
  k -= Math.max(0, periodic(x, y * 0.06, 5, seed + 2, w) - 0.55) * 0.22 * Math.max(0, v); // streaks from the slab
  k -= Math.max(0, (v - 0.84) / 0.16) * 0.12;
  return scale(PLASTER, k);
}

// Green-framed window with two leaves, a middle post and a steel grille.
// (fu, fv) in 0..1 across the window; pw, ph its size in pixels.
function windowPixel(fu, fv, pw, ph, x, y, seed) {
  const frame = 6 / pw, frameV = 6 / ph;
  if (fu < frame || fu > 1 - frame || fv < frameV || fv > 1 - frameV || Math.abs(fu - 0.5) < frame / 2) return scale(GREEN, 0.92 + hash(x, y, seed) * 0.06);
  if (Math.abs(fv - 0.62) < frameV / 2) return scale(GREEN, 0.9); // transom
  let c = mix([50, 62, 68], [112, 132, 142], fv * 0.6 + hash(x, y, seed) * 0.04); // glass with sky
  if (Math.abs(fu - fv * 0.6 - 0.25) < 0.08) c = mix(c, [168, 184, 190], 0.35); // reflection
  if (fv > 0.78 && fv < 0.97) c = mix(c, [196, 176, 150], 0.55); // curtain rod and pelmet
  if ((x % 12) < 2) c = [40, 42, 42]; // grille bars
  return c;
}

function paintFront(atlas) {
  const [, , w, h] = regions.front;
  atlas.paint(regions.front, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = plaster(x, y, w, h, 11);
    // Veranda: railing wall with a green cap, the jali lattice above in a plaster frame.
    if (u > 0.07 && u < 0.55) {
      if (v > 0.285 && v < 0.305) c = GREEN;
      else if (v > 0.305 && v < 0.86) {
        const fu = (u - 0.07) * w, fv = (v - 0.305) * h;
        const border = fu < 5 || fu > (0.48 * w) - 5 || fv < 5 || fv > 0.555 * h - 5;
        const cx = Math.floor((fu - 5) / 16), cy = Math.floor((fv - 5) / 16);
        const rib = (fu - 5) % 16 < 6 || (fv - 5) % 16 < 6;
        if (border || rib) c = scale(plaster(x, y, w, h, 13), 0.97);
        else {
          c = mix([52, 48, 42], [92, 84, 74], valueNoise(x, y, 30, 17)); // the veranda behind
          const r = hash(cx, cy, 19);
          if (r > 0.9) c = mix(c, r > 0.96 ? [170, 70, 90] : [70, 90, 150], 0.45); // washing on the line
          if (fv < 12) c = scale(c, 0.8);
        }
      }
    }
    // Window with its sill.
    if (u > 0.64 && u < 0.93 && v > 0.27 && v < 0.76) c = windowPixel((u - 0.64) / 0.29, (v - 0.27) / 0.49, 0.29 * w, 0.49 * h, x, y, 23);
    if (u > 0.625 && u < 0.945 && v > 0.25 && v < 0.27) c = [214, 206, 172];
    return c;
  });
}

function paintBack(atlas) {
  const [, , w, h] = regions.back;
  atlas.paint(regions.back, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = plaster(x, y, w, h, 31);
    if (u > 0.26 && u < 0.72 && v > 0.27 && v < 0.76) c = windowPixel((u - 0.26) / 0.46, (v - 0.27) / 0.49, 0.46 * w, 0.49 * h, x, y, 37);
    if (u > 0.245 && u < 0.735 && v > 0.25 && v < 0.27) c = [214, 206, 172];
    // Bathroom vent: green frame, louvres.
    if (u > 0.81 && u < 0.93 && v > 0.63 && v < 0.77) {
      const fu = (u - 0.81) / 0.12, fv = (v - 0.63) / 0.14;
      c = fu < 0.12 || fu > 0.88 || fv < 0.1 || fv > 0.9 ? GREEN : (Math.floor(fv * 7) % 2 ? [70, 76, 76] : [150, 156, 150]);
    }
    return c;
  });
}

export async function paint(atlas, { W, D }) {
  paintFront(atlas);
  paintBack(atlas);
  atlas.paint(regions.end, (x, y, w, h) => plaster(x, y, w, h, 41));
  // Below the walls: their bottom row continued.
  for (let y = 400; y < 424; y += 1) for (let x = 0; x < atlas.size; x += 1) atlas.put(x, y, atlas.get(x, 399));
  // The roof covers W x D metres: its rows are scaled to the columns' pixels per metre,
  // so stains stay round; it repeats across, and the margin round it continues it.
  const [rx, ry, rw, rh] = regions.roof;
  atlas.paint([rx - 128, ry - 16, rw + 256, rh + 32], (px, py) => {
    const x = ((px - 128) % rw + rw) % rw, my = ((py - 16) * D * rw) / (W * rh);
    const k = 1 + (hash(x, py, 51) - 0.5) * 0.07 + (periodic(x, my, 60, 52, rw) - 0.5) * 0.12;
    return scale(mix([100, 98, 92], [120, 117, 108], periodic(x, my, 128, 53, rw)), k);
  });
  for (const [name, color] of Object.entries(SWATCH)) {
    const [x0, y0, w, h] = regions[name];
    atlas.paint([x0 - 32, y0 - 32, w + 64, h + 64], (x, y) => scale(color, 1 + (hash(x, y, 60) - 0.5) * 0.03));
  }
}

// ---- Geometry ------------------------------------------------------------------------
// W: bay width, D: depth, H: storey height (the footprint box); spec.module.parapet.
export function build(mesh, { W, D, H, spec }) {
  const { rect, box } = mesh;
  const PARAPET = spec.module.parapet, SLAB = 0.75, INSET = 0.03;
  const [s0, s1] = [H - 0.22, H - INSET]; // slab bottom and top
  const Y = [0, 1, 0];

  // Walls and roof.
  rect([0, H / 2, D / 2], [0, 0, 1], [1, 0, 0], W, H, "front", 0.97);
  rect([0, H / 2, -D / 2], [0, 0, -1], [-1, 0, 0], W, H, "back", 0.97);
  rect([W / 2, H / 2, 0], [1, 0, 0], [0, 0, -1], D, H, "end", 0.97);
  rect([-W / 2, H / 2, 0], [-1, 0, 0], [0, 0, 1], D, H, "end", 0.97);
  rect([0, H, 0], Y, [1, 0, 0], W, D, "roof", 1);

  // Slab round the floor: front and back along the bay, the ends including the corners.
  // Green edge outside, pale top, shaded underside.
  const slab = (xs, zs, edge) => {
    box(xs, [s0, s1], zs, edge, "green", 1);
    box(xs, [s0, s1], zs, "+y", "slab", 1);
    box(xs, [s0, s1], zs, "-y", "slab", 0.72);
  };
  slab([-W / 2, W / 2], [D / 2, D / 2 + SLAB], "+z");
  slab([-W / 2, W / 2], [-D / 2 - SLAB, -D / 2], "-z");
  slab([W / 2, W / 2 + SLAB], [-D / 2 - SLAB, D / 2 + SLAB], "+x +z -z");
  slab([-W / 2 - SLAB, -W / 2], [-D / 2 - SLAB, D / 2 + SLAB], "-x +z -z");

  // Parapets on the front and back, inside the wall planes.
  for (const z of [D / 2 - INSET, -D / 2 + INSET]) {
    const out = Math.sign(z);
    const zs = out > 0 ? [z - 0.2, z] : [z, z + 0.2];
    box([-W / 2, W / 2], [H, H + PARAPET], zs, out > 0 ? "+z" : "-z", "cream", 0.97);
    box([-W / 2, W / 2], [H, H + PARAPET], zs, out > 0 ? "-z" : "+z", "cream", 0.85);
    box([-W / 2, W / 2], [H, H + PARAPET], zs, "+x -x", "cream", 0.9);
    box([-W / 2, W / 2], [H + PARAPET - 0.01, H + PARAPET], zs, "+y", "coping", 1);
  }
  return { module: `${W} m bay x ${D} m deep x ${H} m storey, ${PARAPET} m parapet` };
}
