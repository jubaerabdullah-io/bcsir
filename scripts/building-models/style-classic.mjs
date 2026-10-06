// "classic" style: the Institute of Energy Research & Development (reference photo
// backup/models/source/ierd/photo-1.png). A cream-painted block on the footprint
// rectangle: flat pilasters between the window bays, brown-framed windows with a
// recessed panel under each, frosted glass on the ground floor, a floor band on
// every floor, a plain top band with a cornice and the parapet. On the front: the
// pink brick-tile entrance section with the glass doors, a wide concrete canopy
// with the green signboard on it, two deep sloped hoods at the roof line over a dark
// band, and pink paving along the front.
import { concrete, hash, mix, rng, scale, valueNoise } from "./atlas.mjs";

export const regions = {
  cell: [0, 0, 256, 288],
  cellAC: [256, 0, 256, 288],
  ground: [512, 0, 256, 304],
  door: [768, 0, 256, 304],
  brick: [0, 304, 256, 256],
  band: [256, 304, 256, 128],
  paving: [512, 304, 256, 128],
  roof: [768, 304, 256, 256],
  sign: [0, 576, 1024, 128],
  cream: [256, 448, 64, 64],
  soffit: [320, 448, 64, 64],
  darkBand: [384, 448, 64, 64],
  pink: [448, 448, 64, 64],
  grey: [512, 448, 64, 64],
  white: [576, 448, 64, 64]
};
const SWATCH = { cream: [232, 224, 202], soffit: [214, 208, 190], darkBand: [40, 48, 66], pink: [198, 134, 122], grey: [168, 166, 160], white: [238, 236, 230] };
export const swatches = Object.keys(SWATCH);
const CREAM = [230, 222, 198];

// ---- Texture -------------------------------------------------------------------------
// Upper-floor bay (3 m x one floor): brown-framed window, a recessed panel below it,
// the floor line at the bottom; ac: an outdoor AC unit on a bracket under the window.
function paintCell(atlas, region, ac, seed) {
  const [, , w, h] = region;
  atlas.paint(region, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete(CREAM, x, y, seed, 3, 6);
    if (u > 0.12 && u < 0.88 && v > 0.14 && v < 0.4) c = Math.abs(u - 0.12) < 0.02 || Math.abs(u - 0.88) < 0.02 || Math.abs(v - 0.4) < 0.015 ? [196, 188, 166] : scale(c, 0.96); // panel
    if (u > 0.1 && u < 0.9 && v > 0.48 && v < 0.9) {
      const fu = (u - 0.1) / 0.8, fv = (v - 0.48) / 0.42;
      c = fu < 0.05 || fu > 0.95 || fv < 0.07 || fv > 0.93 || Math.abs(fu - 0.5) < 0.025 ? [88, 62, 44] : mix([48, 54, 58], [92, 100, 104], fv * 0.7 + valueNoise(x, y, 20, seed) * 0.3);
    }
    if (ac && u > 0.18 && u < 0.62 && v > 0.19 && v < 0.4) {
      const au = (u - 0.18) / 0.44, av = (v - 0.19) / 0.21;
      c = [226, 228, 226];
      if (Math.hypot((au - 0.3) * 2.1, av - 0.5) < 0.36) c = [70, 72, 74];
      if (av < 0.06) c = [110, 110, 108];
    }
    if (v < 0.04) c = [206, 198, 176];
    return c;
  });
}

function paintGround(atlas) {
  const [, , w, h] = regions.ground;
  atlas.paint(regions.ground, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete(CREAM, x, y, 21, 3, 6);
    if (v < 0.1) c = concrete([204, 196, 174], x, y, 22, 3, 4);
    if (u > 0.12 && u < 0.88 && v > 0.22 && v < 0.78) {
      const fu = (u - 0.12) / 0.76, fv = (v - 0.22) / 0.56;
      c = fu < 0.05 || fu > 0.95 || fv < 0.06 || fv > 0.94 || Math.abs(fu - 0.5) < 0.02 ? [74, 58, 46] : mix([226, 230, 230], [196, 204, 206], fv); // frosted glass
    }
    return c;
  });
}

function paintDoor(atlas) {
  const [, , w, h] = regions.door;
  atlas.paint(regions.door, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = mix([150, 170, 158], [196, 208, 198], v); // lit lobby with pale green walls
    if (u < 0.08 || u > 0.92) c = [96, 60, 44]; // wooden door leaves, open
    if (Math.abs((u * 4) % 1 - 0.5) > 0.47 || v > 0.94) c = [70, 64, 60];
    if (v < 0.04) c = [150, 146, 140];
    return c;
  });
}

function paintBrick(atlas) {
  atlas.paint(regions.brick, (x, y) => {
    const row = Math.floor(y / 11), col = Math.floor(x / 34);
    if (y % 11 < 1.5 || x % 34 < 1.5) return [222, 196, 186];
    return scale(mix([196, 128, 116], [214, 150, 138], hash(col, row, 5)), 1 + (valueNoise(x, y, 26, 6) - 0.5) * 0.06);
  });
}

function paintPaving(atlas) {
  atlas.paint(regions.paving, (x, y) => {
    const tile = (Math.floor(x / 16) + Math.floor(y / 16)) % 2;
    if (x % 16 < 1 || y % 16 < 1) return [206, 196, 190];
    return tile ? [208, 146, 140] : [224, 196, 186];
  });
}

async function paintSign(atlas, feature) {
  const region = regions.sign;
  const [, , w, h] = region;
  atlas.paint(region, (x, y) => {
    if (x < 5 || y < 5 || x >= w - 5 || y >= h - 5) return [222, 214, 170];
    const d = Math.hypot(x - h * 0.55, y - h * 0.5);
    if (d < h * 0.28) return d > h * 0.23 ? [36, 56, 120] : d > h * 0.2 ? [236, 236, 232] : [204, 42, 46]; // emblem
    return concrete([28, 76, 46], x, y, 71, 2, 3);
  });
  const p = feature.properties;
  const english = `${String(p.name_en || "").trim()}${p.name_en_short ? ` (${p.name_en_short})` : ""}`;
  await atlas.text(region, [
    ...(p.name_bn ? [{ text: p.name_bn, height: 0.22, top: 0.06, color: "#f3e7b0", bold: true, maxWidth: 0.7 }] : []),
    { text: english, height: 0.32, top: 0.3, color: "#f5d96a", bold: true, font: "Arial", maxWidth: 0.78 },
    { text: "Bangladesh Council of Scientific and Industrial Research (BCSIR)", height: 0.16, top: 0.68, color: "#e8e4cf", font: "Arial", maxWidth: 0.6 }
  ]);
}

export async function paint(atlas, { feature }) {
  paintCell(atlas, regions.cell, false, 11);
  paintCell(atlas, regions.cellAC, true, 13);
  paintGround(atlas);
  paintDoor(atlas);
  paintBrick(atlas);
  atlas.paint(regions.band, (x, y) => concrete(CREAM, x, y, 31, 3, 6));
  paintPaving(atlas);
  atlas.paint(regions.roof, (x, y) => concrete([170, 168, 162], x, y, 41, 5, 12));
  for (const [name, color] of Object.entries(SWATCH)) atlas.paint(regions[name], (x, y) => concrete(color, x, y, 60, 2, 0));
  await paintSign(atlas, feature);
}

// ---- Geometry ------------------------------------------------------------------------
export function build(mesh, { W, D, H, entranceOffset, spec }) {
  const { fbox, face, rect, SIDES, span } = mesh;
  const GROUND = spec.groundHeight ?? 3.6, PARAPET = 0.9;
  const TOP = H - (spec.topBand ?? 1.8); // top of the upper floors
  const floors = Math.max(1, Math.round((TOP - GROUND) / (spec.floorHeight ?? 3.3)));
  const f = (TOP - GROUND) / floors;
  const WALL = 0.15; // wall plane behind the pilasters
  const random = rng(29);

  for (const side of Object.keys(SIDES)) {
    const { S } = SIDES[side];
    const n = Math.max(2, Math.round(S / (spec.bay ?? 3.0)));
    const m = S / n;
    const front = side === "front";
    const door = front ? W / 2 + entranceOffset : null;
    const brick = front ? [Math.max(0.3, door - 8), Math.min(S - 0.3, door + 3.5)] : null;
    const inBrick = (a) => brick && a > brick[0] && a < brick[1];

    // Bays: ground floor, upper floors, top band.
    for (let k = 0; k < n; k += 1) {
      const [a0, a1] = [k * m, (k + 1) * m];
      if (!inBrick((a0 + a1) / 2)) fbox(side, [a0, a1], [0, GROUND], [WALL, WALL + 0.1], "o", "ground", 0.9);
      for (let i = 0; i < floors; i += 1) fbox(side, [a0, a1], [GROUND + i * f, GROUND + (i + 1) * f], [WALL, WALL + 0.1], "o", i === 0 && random() < 0.3 ? "cellAC" : "cell", 0.9);
    }
    fbox(side, span(side, 0), [TOP, H], [0, 0.1], "o", "band", 0.95);
    // Pilasters and floor bands (flush with the pilasters).
    for (let k = 0; k <= n; k += 1) {
      const a = k * m;
      const pink = inBrick(a);
      fbox(side, [Math.max(0, a - 0.18), Math.min(S, a + 0.18)], [0, TOP], [0, WALL], "o" + (k > 0 ? "l" : "") + (k < n ? "r" : ""), "cream", 1);
      if (pink) fbox(side, [a - 0.2, a + 0.2], [0, GROUND], [-0.02, WALL], "olr", "brick", 1, { o: [0, 0, 0.2, 1], l: [0, 0, 0.1, 1], r: [0, 0, 0.1, 1] });
    }
    for (let i = 1; i <= floors; i += 1) fbox(side, span(side, 0), [GROUND + i * f - 0.14, GROUND + i * f], [0, WALL], "otb", "cream", 1);
    fbox(side, span(side, 0), [GROUND - 0.14, GROUND], [0, WALL], "otb", "cream", 1);
    // Cornice and parapet.
    // The end walls' cornice runs round the corners (it projects outwards).
    const end = mesh.isEnd(side);
    fbox(side, end ? [-0.3, S + 0.3] : [0, S], [H - 0.3, H], [-0.3, 0], end ? "otblr" : "otb", "cream", 1);
    fbox(side, span(side, 0), [H - PARAPET, H], [0, 0.25], "i", "cream", 0.85);
    fbox(side, span(side, 0), [H - 0.01, H], [0, 0.25], "t", "white", 1);

    if (front) {
      // Brick-tile entrance section, glass doors, canopy, signboard, paving.
      const [b0, b1] = brick;
      const cells = Math.max(1, Math.round((b1 - b0) / 3.4));
      for (let k = 0; k < cells; k += 1) {
        const c0 = b0 + ((b1 - b0) * k) / cells, c1 = b0 + ((b1 - b0) * (k + 1)) / cells;
        if (door > c0 - 2.5 && door < c1 + 2.5 && c1 - c0 > 0) {
          const d0 = Math.max(c0, door - 2.5), d1 = Math.min(c1, door + 2.5);
          if (d0 > c0) fbox(side, [c0, d0], [0, GROUND], [WALL, WALL + 0.1], "o", "brick", 1, { o: [0, 0, (d0 - c0) / 3.4, 1] });
          if (d1 < c1) fbox(side, [d1, c1], [0, GROUND], [WALL, WALL + 0.1], "o", "brick", 1, { o: [0, 0, (c1 - d1) / 3.4, 1] });
        } else fbox(side, [c0, c1], [0, GROUND], [WALL, WALL + 0.1], "o", "brick", 1, { o: [0, 0, (c1 - c0) / 3.4, 1] });
      }
      const R = 1.6; // door recess
      fbox(side, [door - 2.5, door + 2.5], [0, GROUND - 0.6], [WALL + R, WALL + R + 0.1], "o", "door", 0.95);
      fbox(side, [door - 2.5, door + 2.5], [GROUND - 0.6, GROUND], [WALL, WALL + R], "ob", "brick", 0.8, { o: [0, 0, 1, 0.3] });
      fbox(side, [door - 2.51, door - 2.5], [0, GROUND], [WALL, WALL + R], "r", "pink", 0.8);
      fbox(side, [door + 2.5, door + 2.51], [0, GROUND], [WALL, WALL + R], "l", "pink", 0.8);
      const canopy = [Math.max(0.2, door - 17), Math.min(S - 0.2, door + 4)];
      fbox(side, canopy, [GROUND - 0.1, GROUND + 0.25], [-2.2, WALL], "otblr", "grey", 1);
      fbox(side, [canopy[0] + 1.2, canopy[1] - 1.0], [GROUND + 0.25, GROUND + 1.55], [-2.1, -2.0], "o", "sign", 1);
      fbox(side, [canopy[0] + 1.2, canopy[1] - 1.0], [GROUND + 0.25, GROUND + 1.55], [-2.1, -2.0], "ilrt", "grey", 0.8);
      fbox(side, [0.3, S - 0.3], [0, 0.03], [-3.0, 0], "t", "paving", 0.9, { t: [0, 0, Math.min(1, (S - 0.6) / 40), 1] });
      // Two deep hoods at the roof line with sloped undersides, a dark band under each.
      const c = W / 2;
      for (const [h0, h1] of [[c - 10.5, c - 1.5], [c + 2.5, c + 11.5]]) {
        if (h0 < 0.5 || h1 > S - 0.5) continue;
        const P = (a, y, d) => mesh.SIDES.front.at(a, y, d);
        const low = TOP + 0.55, top = H + 0.45, edge = H + 0.05, out = -2.1;
        fbox(side, [h0, h1], [TOP + 0.05, low], [0.02, 0.1], "o", "darkBand", 1);
        face([P(h0, edge, out), P(h1, edge, out), P(h1, top, out), P(h0, top, out)], [0, 0, 1], "cream", 1);
        face([P(h0, low, 0), P(h1, low, 0), P(h1, edge, out), P(h0, edge, out)], [0, -0.9, 0.4], "soffit", 0.8);
        face([P(h0, top, 0), P(h1, top, 0), P(h1, top, out), P(h0, top, out)], [0, 1, 0], "grey", 1);
        face([P(h0, low, 0), P(h0, edge, out), P(h0, top, out), P(h0, top, 0)], [-1, 0, 0], "cream", 0.9);
        face([P(h1, low, 0), P(h1, top, 0), P(h1, top, out), P(h1, edge, out)], [1, 0, 0], "cream", 0.9);
      }
    }
  }

  // Roof with a stair room.
  const roofY = H - PARAPET;
  rect([0, roofY, 0], [0, 1, 0], [1, 0, 0], W - 0.5, D - 0.5, "roof", 1);
  mesh.box([-W / 2 + 2, -W / 2 + 6], [roofY, roofY + 2.6], [-D / 2 + 2, -D / 2 + 5], "+z -z +x -x +y", "cream", 0.95);
}
