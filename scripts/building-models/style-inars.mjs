// "inars" style: the Institute of National Analytical Research & Services (reference
// photo backup/models/source/inars/photo-1.png). A long white block on the footprint
// rectangle: on every upper floor a band of blue-tinted windows with dark mullions
// between white spandrels with AC vents, white piers every few bays, a projecting
// cornice at the roof; ground floor white with framed windows. On the front: the porch
// (porte-cochère) at the entrance, its carved frieze cut from the photo, carried by two
// ornate columns (capital and fluted shaft from the photo), a brick-tile wall with a
// grille gate behind it, and the big blue signboard on the wall above the porch.
import { concrete, hash, mix, scale, valueNoise } from "./atlas.mjs";

export const regions = {
  ribbon: [0, 0, 256, 256],
  ground: [256, 0, 256, 256],
  brick: [512, 0, 256, 256],
  gate: [768, 0, 256, 256],
  sign: [0, 272, 768, 192],
  frieze: [0, 480, 1000, 110],
  capital: [0, 608, 96, 80],
  shaft: [112, 608, 48, 256],
  colBase: [176, 608, 64, 64],
  wall: [256, 608, 256, 256],
  roof: [528, 608, 256, 256],
  white: [800, 624, 48, 48],
  ceiling: [864, 624, 48, 48],
  roofGrey: [928, 624, 48, 48],
  blueEdge: [800, 688, 48, 48]
};
const WHITE = [236, 234, 226];
const SWATCH = { white: WHITE, ceiling: [226, 224, 216], roofGrey: [160, 158, 150], blueEdge: [40, 46, 110] };
export const swatches = Object.keys(SWATCH);
const PIECE = 2.4; // metres of window band per texture repeat

// Blue reflective glass: sky above, a band of reflected trees.
function glass(x, y, h) {
  const fv = 1 - y / h;
  let c = mix([40, 90, 170], [150, 190, 230], fv);
  const trees = valueNoise(x, y, 18, 7) * 0.6 + valueNoise(x, y, 6, 8) * 0.4;
  if (fv < 0.55 + trees * 0.25) c = mix(c, [40, 70, 60], 0.45 * trees);
  return c;
}

export async function paint(atlas, { photo }) {
  // Upper floor piece (2.4 m x one storey): spandrel with a vent, the window band.
  atlas.paint(regions.ribbon, (x, y, w, h) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete(WHITE, x, y, 11, 3, 5);
    if (v > 0.27 && v < 0.8) {
      c = glass(x, y - h * 0.2, h * 0.53);
      if (u < 0.025 || Math.abs(u - 0.5) < 0.012 || v < 0.29 || v > 0.78) c = [44, 48, 56]; // mullions and frame
    }
    if (u > 0.08 && u < 0.3 && v > 0.84 && v < 0.93) c = (y % 4 < 2) ? [90, 92, 94] : [180, 182, 180]; // AC vent louvres
    if (v < 0.03) c = scale(c, 0.9);
    return c;
  });
  // Ground floor bay (3 m): a framed window with dark blue frame.
  atlas.paint(regions.ground, (x, y, w, h) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete(WHITE, x, y, 13, 3, 5);
    if (u > 0.2 && u < 0.8 && v > 0.3 && v < 0.62) c = u < 0.23 || u > 0.77 || v < 0.33 || v > 0.59 || Math.abs(u - 0.5) < 0.012 ? [36, 42, 90] : glass(x, y, h);
    if (v < 0.05) c = [120, 118, 110];
    return c;
  });
  // Brick-tile cladding (grey-brown split tiles).
  atlas.paint(regions.brick, (x, y) => {
    const row = Math.floor(y / 12), col = Math.floor((x + (row % 2) * 20) / 40);
    if (y % 12 < 2 || (x + (row % 2) * 20) % 40 < 2) return [176, 168, 156];
    return scale(mix([120, 92, 78], [156, 120, 98], hash(col, row, 21)), 0.94 + hash(x, y, 22) * 0.1);
  });
  // Collapsible grille gate in front of the dark doorway.
  atlas.paint(regions.gate, (x, y, w, h) => {
    const v = 1 - y / h;
    const c = mix([30, 30, 32], [70, 66, 62], v * 0.4);
    if (x % 16 < 3 || Math.abs(((y + (Math.floor(x / 16) % 2) * 12) % 24) - 12) < 2) return [58, 60, 62];
    return c;
  });
  // Signboard: blue, the emblem, the institute in white and the council in gold (as in the photo).
  const [sx, sy, sw, sh] = regions.sign;
  atlas.paint(regions.sign, (x, y, w, h) => {
    if (x < 6 || y < 6 || x >= w - 6 || y >= h - 6) return [214, 214, 224];
    const d = Math.hypot(x - h * 0.55, y - h * 0.5);
    if (d < h * 0.3) return d > h * 0.25 ? [214, 180, 60] : d > h * 0.21 ? [236, 236, 232] : d > h * 0.1 ? [196, 40, 44] : [36, 60, 130];
    return concrete([38, 44, 118], x, y, 31, 2, 3);
  });
  await atlas.text([sx + sh, sy, sw - sh, sh], [
    { text: "ইনস্টিটিউট অব ন্যাশনাল এনালাইটিক্যাল রিসার্চ এন্ড সার্ভিস (INARS)", height: 0.26, top: 0.12, color: "#ffffff", bold: true, maxWidth: 0.95 },
    { text: "বাংলাদেশ বিজ্ঞান ও শিল্প গবেষণা পরিষদ", height: 0.3, top: 0.55, color: "#f2c14e", bold: true, maxWidth: 0.8 }
  ]);
  const cut = (region, quad) => atlas.photo(regions[region], photo("inars/photo-1.png"), quad, { sharpen: 0.3 });
  if (!(await cut("frieze", [[62, 262], [502, 348], [502, 394], [62, 322]]))) atlas.paint(regions.frieze, () => WHITE);
  if (!(await cut("capital", [[75, 340], [140, 340], [140, 400], [75, 400]]))) atlas.paint(regions.capital, () => WHITE);
  if (!(await cut("shaft", [[80, 402], [124, 402], [125, 620], [81, 620]]))) atlas.paint(regions.shaft, () => WHITE);
  // Column base: stacked white rings.
  atlas.paint(regions.colBase, (x, y, w, h) => scale(WHITE, 0.8 + 0.2 * Math.abs(Math.sin((y / h) * Math.PI * 3))));
  atlas.paint(regions.wall, (x, y) => concrete(WHITE, x, y, 41, 3, 6));
  atlas.paint(regions.roof, (x, y) => concrete([150, 148, 142], x, y, 51, 5, 12));
  for (const [name, color] of Object.entries(SWATCH)) {
    const [x0, y0, w, h] = regions[name];
    atlas.paint([x0 - 8, y0 - 8, w + 16, h + 16], (x, y) => scale(color, 1 + (hash(x, y, 60) - 0.5) * 0.04));
  }
}

// ---- Geometry ------------------------------------------------------------------------
export function build(mesh, { W, D, H, entranceOffset }) {
  const { fbox, face, rect, box, SIDES, span } = mesh;
  const GROUND = 4.0, PARAPET = 1.0, roofY = H - PARAPET;
  const floors = Math.max(1, Math.round((roofY - GROUND) / 3.3));
  const f = (roofY - GROUND) / floors;
  const door = Math.min(W - 5, Math.max(5, W / 2 + entranceOffset));
  const PORCH = [door - 3.8, door + 3.8], PD = 5.8;

  for (const side of Object.keys(SIDES)) {
    const { S } = SIDES[side];
    const [a0, a1] = span(side, 0);
    // Piers every 3 pieces of window band; the bands between them.
    const groups = Math.max(1, Math.round((a1 - a0) / (3 * PIECE + 0.8)));
    const gw = (a1 - a0) / groups;
    for (let g = 0; g < groups; g += 1) {
      const g0 = a0 + g * gw + 0.4, g1 = a0 + (g + 1) * gw - 0.4;
      const n = Math.max(1, Math.round((g1 - g0) / PIECE)), m = (g1 - g0) / n;
      for (let k = 0; k < n; k += 1) for (let i = 0; i < floors; i += 1) fbox(side, [g0 + k * m, g0 + (k + 1) * m], [GROUND + i * f, GROUND + (i + 1) * f], [0.15, 0.25], "o", "ribbon", 0.95);
      // Piers at the group's ends (full height of the upper floors).
      for (const p of [g0 - 0.4, g1]) fbox(side, [p, p + 0.4], [GROUND, roofY], [-0.2, 0.15], "olr", "white", 1);
    }
    // Ground floor bays (the front leaves out the porch's brick wall).
    const groundBays = (b0, b1) => {
      if (b1 - b0 < 0.3) return;
      const n = Math.max(1, Math.round((b1 - b0) / 3)), m = (b1 - b0) / n;
      for (let k = 0; k < n; k += 1) fbox(side, [b0 + k * m, b0 + (k + 1) * m], [0, GROUND], [0, 0.1], "o", "ground", 0.95);
    };
    if (side === "front") { groundBays(a0, PORCH[0]); groundBays(PORCH[1], a1); } else groundBays(a0, a1);
    // Band at the first floor and the cornice (the end walls' run round the corners), parapet.
    const end = mesh.isEnd(side);
    fbox(side, end ? [-0.2, S + 0.2] : [0, S], [GROUND - 0.3, GROUND], [-0.2, 0.15], end ? "otblr" : "otb", "white", 1);
    fbox(side, end ? [-0.5, S + 0.5] : [0, S], [roofY - 0.1, roofY + 0.2], [-0.5, 0], end ? "otblr" : "otb", "white", 1);
    fbox(side, span(side, 0), [roofY + 0.2, H], [0, 0.1], "o", "wall", 0.97, { o: [0, 0, 1, 0.1] });
    fbox(side, span(side, 0), [roofY, H], [0, 0.25], "i", "ceiling", 0.85);
    fbox(side, span(side, 0), [H - 0.01, H], [0, 0.25], "t", "white", 1);
  }

  const F = SIDES.front;
  // Behind the porch: brick-tile wall with the grille gate.
  const bw = PORCH[1] - PORCH[0];
  fbox(F, PORCH, [0, GROUND], [0, 0.1], "o", "brick", 1, { o: [0, 0, Math.min(1, bw / 8), 1] });
  fbox(F, [door - 1.4, door + 1.4], [0, 2.8], [-0.02, 0.05], "o", "gate", 0.95);

  // Porch: flat roof; a band with the carved frieze along its front and sides (their
  // inner faces and undersides plain); white ceiling.
  const [p0, p1] = PORCH, FR = [3.3, 4.2], B = 0.3;
  const sideShare = Math.min(1, PD / bw);
  fbox(F, [p0, p1], [FR[1] - 0.05, FR[1]], [-PD, 0], "t", "roofGrey", 1);
  fbox(F, [p0, p1], FR, [-PD, -PD + B], "o", "frieze", 1);
  fbox(F, [p0 + B, p1 - B], FR, [-PD, -PD + B], "i", "ceiling", 0.75);
  fbox(F, [p0, p1], FR, [-PD, -PD + B], "b", "ceiling", 0.8);
  fbox(F, [p0, p0 + B], FR, [-PD, 0], "l", "frieze", 1, { l: [0, 0, sideShare, 1] });
  fbox(F, [p1 - B, p1], FR, [-PD, 0], "r", "frieze", 1, { r: [1 - sideShare, 0, 1, 1] });
  fbox(F, [p0, p0 + B], FR, [-PD + B, 0], "rb", "ceiling", 0.75);
  fbox(F, [p1 - B, p1], FR, [-PD + B, 0], "lb", "ceiling", 0.75);
  fbox(F, [p0 + B, p1 - B], [FR[0], FR[0] + 0.02], [-PD + B, 0], "b", "ceiling", 0.8);

  // Two ornate columns under the porch's front corners: square plinth, ringed base,
  // fluted shaft and Corinthian capital (12-sided, the photo wrapped twice round).
  const column = (a) => {
    const [cx, , cz] = F.at(a, 0, -PD + 0.45);
    box([cx - 0.3, cx + 0.3], [0, 0.3], [cz - 0.3, cz + 0.3], "+x -x +z -z +y", "white", 1);
    const ring = (y0, y1, r0, r1, region) => {
      for (let k = 0; k < 12; k += 1) {
        const [t0, t1] = [(k / 12) * Math.PI * 2, ((k + 1) / 12) * Math.PI * 2], tm = (t0 + t1) / 2;
        const u0 = (k % 6) / 6, u1 = ((k % 6) + 1) / 6;
        face([[cx + r0 * Math.cos(t0), y0, cz + r0 * Math.sin(t0)], [cx + r0 * Math.cos(t1), y0, cz + r0 * Math.sin(t1)], [cx + r1 * Math.cos(t1), y1, cz + r1 * Math.sin(t1)], [cx + r1 * Math.cos(t0), y1, cz + r1 * Math.sin(t0)]], [Math.cos(tm), 0, Math.sin(tm)], region, 1, [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
      }
    };
    ring(0.3, 0.65, 0.3, 0.26, "colBase");
    ring(0.65, 2.75, 0.2, 0.19, "shaft");
    ring(2.75, FR[0], 0.22, 0.36, "capital");
  };
  column(p0 + 0.45);
  column(p1 - 0.45);

  // Blue signboard on the wall above the porch.
  fbox(F, [door - 4.6, door + 4.6], [FR[1] + 0.3, FR[1] + 2.6], [-0.35, -0.2], "o", "sign", 1);
  fbox(F, [door - 4.6, door + 4.6], [FR[1] + 0.3, FR[1] + 2.6], [-0.35, -0.2], "lrtb", "blueEdge", 1);

  // Roof and a stair room.
  rect([0, roofY, 0], [0, 1, 0], [1, 0, 0], W - 0.5, D - 0.5, "roof", 1);
  box([-W / 2 + 3, -W / 2 + 8], [roofY, roofY + 2.8], [-D / 2 + 2, -D / 2 + 6], "+z -z +x -x", "wall", 0.95);
  box([-W / 2 + 2.8, -W / 2 + 8.2], [roofY + 2.8, roofY + 3.0], [-D / 2 + 1.8, -D / 2 + 6.2], "+z -z +x -x +y", "white", 1);
  return { facades: [`${floors + 1} storeys; porch at ${door.toFixed(1)} m of the ${W.toFixed(1)} m front`] };
}
