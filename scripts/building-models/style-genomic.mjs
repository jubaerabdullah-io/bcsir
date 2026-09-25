// "genomic" style: the Genomic Research Laboratories (reference photo
// backup/models/source/genomic/photo-1.png). A plain block on the footprint rectangle
// in weathered pale grey-beige plaster: windows with white frames and grilles under a
// thin sunshade on every floor, a parapet. On the front: the stair bay standing out at
// the entrance, edged with strips of patterned brown brick lattice, small windows at
// the landings, rising above the roof; the entrance under a flat canopy carrying the
// white signboard (cut from the photo), the folded grille gate, red tiles in front.
import { concrete, hash, mix, scale, valueNoise } from "./atlas.mjs";

export const regions = {
  bay: [0, 0, 256, 288],
  bayGround: [256, 0, 256, 288],
  stair: [512, 0, 256, 288],
  doorway: [768, 0, 256, 288],
  sign: [0, 304, 620, 112],
  lattice: [640, 304, 64, 256],
  plaster: [0, 432, 256, 256],
  tiles: [272, 432, 256, 128],
  cream: [736, 320, 48, 48],
  soffit: [800, 320, 48, 48],
  coping: [864, 320, 48, 48],
  slab: [928, 320, 48, 48],
  roof: [736, 400, 256, 256]
};
const PLASTER = [206, 200, 182];
const SWATCH = { cream: PLASTER, soffit: [224, 222, 214], coping: [226, 224, 216], slab: [196, 192, 180] };
export const swatches = Object.keys(SWATCH);

// Weathered plaster: blotches, grey streaks below the sills and the top.
function plaster(x, y, w, h, seed) {
  let c = concrete(PLASTER, x, y, seed, 4, 8);
  c = scale(c, 1 - Math.max(0, valueNoise(x * 0.8, y * 0.06, 4, seed + 1) - 0.58) * 0.35);
  return c;
}

// White-framed window with two leaves and a grille; (fu, fv) 0..1 across it.
function windowPixel(fu, fv, x, y) {
  if (fu < 0.05 || fu > 0.95 || fv < 0.05 || fv > 0.95 || Math.abs(fu - 0.5) < 0.02) return [232, 232, 226];
  let c = mix([46, 58, 64], [120, 138, 146], fv * 0.6 + valueNoise(x, y, 20, 5) * 0.2);
  if (fu > 0.08 && fu < 0.45 && fv > 0.1 && fv < 0.85 && valueNoise(x, y, 30, 6) > 0.55) c = mix(c, [200, 190, 170], 0.5); // curtain
  if (x % 11 < 2) c = [58, 54, 50]; // grille
  return c;
}

function paintBay(atlas, region, ground) {
  const [, , w, h] = region;
  atlas.paint(region, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = plaster(x, y, w, h, ground ? 13 : 11);
    const [v0, v1] = ground ? [0.3, 0.8] : [0.26, 0.82];
    if (u > 0.22 && u < 0.78 && v > v0 && v < v1) c = windowPixel((u - 0.22) / 0.56, (v - v0) / (v1 - v0), x, y);
    if (u > 0.2 && u < 0.8 && v > v0 - 0.03 && v <= v0) c = [214, 210, 198]; // sill
    if (ground && v < 0.06) c = scale(c, 0.85); // plinth
    return c;
  });
}

export async function paint(atlas, { photo }) {
  paintBay(atlas, regions.bay, false);
  paintBay(atlas, regions.bayGround, true);
  // Stair bay: a small window at the landing, half a floor up.
  atlas.paint(regions.stair, (x, y, w, h) => {
    const u = x / w, v = 1 - y / h;
    const c = plaster(x, y, w, h, 17);
    return u > 0.4 && u < 0.6 && v > 0.52 && v < 0.78 ? windowPixel((u - 0.4) / 0.2, (v - 0.52) / 0.26, x, y) : c;
  });
  // Entrance: the dark lobby, the folded grille gate at the left, the door frame.
  atlas.paint(regions.doorway, (x, y, w, h) => {
    const u = x / w, v = 1 - y / h;
    let c = mix([40, 38, 36], [96, 90, 80], v * 0.5 + valueNoise(x, y, 40, 21) * 0.3);
    if (u < 0.2) c = (x % 9 < 3) || (Math.abs(((y % 26) / 26) - 0.5) < 0.12) ? [74, 56, 44] : mix(c, [60, 48, 40], 0.4);
    if (u > 0.94 || v > 0.95) c = [220, 218, 210];
    return c;
  });
  if (!(await atlas.photo(regions.sign, photo("genomic/photo-1.png"), [[129, 391], [439, 380], [440, 437], [131, 448]], { sharpen: 0.4 }))) {
    atlas.paint(regions.sign, () => [240, 240, 236]);
  }
  // Brick lattice: brown blocks with a cross-shaped opening, in a 20 cm grid.
  atlas.paint(regions.lattice, (x, y, w) => {
    const cell = w / 2, fx = (x % cell) / cell, fy = (y % cell) / cell;
    if (fx < 0.08 || fy < 0.08) return [150, 140, 128];
    const hole = (Math.abs(fx - 0.54) < 0.12 && fy > 0.24 && fy < 0.84) || (Math.abs(fy - 0.54) < 0.12 && fx > 0.24 && fx < 0.84);
    return hole ? [40, 36, 34] : scale(mix([148, 88, 60], [172, 110, 76], hash(Math.floor(x / cell), Math.floor(y / cell), 31)), 0.94 + hash(x, y, 32) * 0.1);
  });
  atlas.paint(regions.plaster, (x, y, w, h) => plaster(x, y, w, h, 41));
  atlas.paint(regions.tiles, (x, y) => (x % 32 < 2 || y % 32 < 2 ? [150, 110, 92] : scale([184, 104, 84], 0.92 + hash(Math.floor(x / 32), Math.floor(y / 32), 51) * 0.14)));
  atlas.paint(regions.roof, (x, y) => concrete([150, 148, 140], x, y, 61, 5, 12));
  for (const [name, color] of Object.entries(SWATCH)) {
    const [x0, y0, w, h] = regions[name];
    atlas.paint([x0 - 8, y0 - 8, w + 16, h + 16], (x, y) => scale(color, 1 + (hash(x, y, 60) - 0.5) * 0.04));
  }
}

// ---- Geometry ------------------------------------------------------------------------
export function build(mesh, { W, H, entranceOffset }) {
  const { fbox, rect, SIDES, span } = mesh;
  const GROUND = 3.6, PARAPET = 1.0, roofY = H - PARAPET;
  const floors = Math.max(1, Math.round((roofY - GROUND) / 3.4));
  const f = (roofY - GROUND) / floors;
  const levels = [0, ...Array.from({ length: floors }, (_, i) => GROUND + i * f), roofY];
  const door = W / 2 + entranceOffset, TOWER = [door - 3, door + 3], OUT = 0.6, RISE = 2.8;

  // Window bays of about 3.3 m along [a0, a1] of a side, a sunshade over each window.
  const bays = (side, a0, a1) => {
    if (a1 - a0 < 0.3) return;
    const n = Math.max(1, Math.round((a1 - a0) / 3.3)), m = (a1 - a0) / n;
    for (let k = 0; k < n; k += 1) {
      const [b0, b1] = [a0 + k * m, a0 + (k + 1) * m];
      for (let i = 0; i + 1 < levels.length; i += 1) {
        fbox(side, [b0, b1], [levels[i], levels[i + 1]], [0, 0.1], "o", i === 0 ? "bayGround" : "bay", 0.95);
        const top = levels[i] + (levels[i + 1] - levels[i]) * (i === 0 ? 0.8 : 0.82) + 0.05;
        fbox(side, [b0 + m * 0.18, b1 - m * 0.18], [top, top + 0.08], [-0.45, 0], "otblr", "slab", 1);
      }
    }
  };
  for (const side of Object.keys(SIDES)) {
    const { S } = SIDES[side];
    const [a0, a1] = span(side, 0);
    // The front's bays leave out the stair bay, which stands in front of the wall.
    if (side === "front") { bays(side, a0, TOWER[0]); bays(side, TOWER[1], a1); } else bays(side, a0, a1);
    // Parapet: plaster outside, inside face and coping.
    fbox(side, span(side, 0), [roofY, H], [0, 0.1], "o", "plaster", 0.97, { o: [0, 0, Math.min(1, S / 20), 0.25] });
    fbox(side, span(side, 0), [roofY, H], [0, 0.25], "i", "cream", 0.85);
    fbox(side, span(side, 0), [H - 0.01, H], [0, 0.25], "t", "coping", 1);
  }

  // Stair bay at the entrance: lattice strips at its edges, landing windows, rising
  // above the roof to a flat top.
  const T = SIDES.front, top = roofY + RISE, strip = 0.6, DEEP = 4.2;
  // Upper floors: landing windows between the lattice strips.
  for (let i = 1; i + 1 < levels.length; i += 1) {
    const [y0, y1] = [levels[i], levels[i + 1]];
    fbox(T, [TOWER[0] + strip, TOWER[1] - strip], [y0, y1], [-OUT, -OUT + 0.1], "o", "stair", 0.97);
    for (const [s0, s1] of [[TOWER[0], TOWER[0] + strip], [TOWER[1] - strip, TOWER[1]]]) fbox(T, [s0, s1], [y0, y1], [-OUT, -OUT + 0.1], "o", "lattice", 1, { o: [0, 0, 1, Math.min(1, (y1 - y0) / 3.6)] });
  }
  // Ground floor: plaster round the doorway.
  fbox(T, [TOWER[0], door - 1.3], [0, GROUND], [-OUT, -OUT + 0.1], "o", "plaster", 0.95, { o: [0, 0, 0.4, 0.4] });
  fbox(T, [door + 1.3, TOWER[1]], [0, GROUND], [-OUT, -OUT + 0.1], "o", "plaster", 0.95, { o: [0, 0, 0.4, 0.4] });
  fbox(T, [door - 1.3, door + 1.3], [2.7, GROUND], [-OUT, -OUT + 0.1], "o", "plaster", 0.95, { o: [0, 0, 0.3, 0.1] });
  // Its sides up to the roof, then the stair room above the roof reaching back over it.
  fbox(T, [TOWER[0], TOWER[1]], [0, roofY], [-OUT, 0], "lr", "plaster", 0.9, { l: [0, 0, 0.1, 1], r: [0, 0, 0.1, 1] });
  fbox(T, [TOWER[0], TOWER[1]], [roofY, top], [-OUT, -OUT + 0.1], "o", "plaster", 0.97, { o: [0, 0, 0.6, 0.3] });
  fbox(T, [TOWER[0], TOWER[1]], [roofY, top], [-OUT, DEEP], "lr", "plaster", 0.9, { l: [0, 0, 1, 0.3], r: [0, 0, 1, 0.3] });
  fbox(T, [TOWER[0], TOWER[1]], [roofY, top], [DEEP - 0.1, DEEP], "i", "plaster", 0.9, { i: [0, 0, 0.6, 0.3] });
  fbox(T, [TOWER[0] - 0.1, TOWER[1] + 0.1], [top, top + 0.15], [-OUT - 0.1, DEEP + 0.1], "otblr", "coping", 1);

  // Entrance: the doorway in the stair bay, flat canopy, signboard, red tiles.
  fbox(T, [door - 1.3, door + 1.3], [0, 2.7], [-OUT, -OUT + 0.02], "o", "doorway", 0.95);
  const C = [door - 3.1, door + 3.1], CD = [-OUT - 2.2, -OUT];
  fbox(T, C, [3.05, 3.35], CD, "otblr", "soffit", 1);
  fbox(T, C, [3.35, 4.35], [CD[0], CD[0] + 0.06], "o", "sign", 1);
  fbox(T, C, [3.35, 4.35], [CD[0], CD[0] + 0.06], "ilrt", "coping", 0.9);
  fbox(T, [door - 1.4, door - 1.3], [0, 3.05], [CD[0] + 0.2, CD[0] + 0.35], "olr", "soffit", 0.95);
  fbox(T, [door + 1.3, door + 1.4], [0, 3.05], [CD[0] + 0.2, CD[0] + 0.35], "olr", "soffit", 0.95);
  rect(T.at(door, 0.03, (CD[0] + CD[1]) / 2), [0, 1, 0], T.right, C[1] - C[0], CD[1] - CD[0], "tiles", 1);

  // Roof.
  rect([0, roofY, 0], [0, 1, 0], [1, 0, 0], W - 0.5, mesh.SIDES.right.S - 0.5, "roof", 1);
  return { facades: [`${floors + 1} storeys, stair bay at ${door.toFixed(1)} m of the ${W.toFixed(1)} m front`] };
}
