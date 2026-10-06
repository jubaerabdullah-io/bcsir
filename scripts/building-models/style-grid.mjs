// "grid" style: the Secretariat Building (reference photo
// backup/models/source/secretariat/photo-1.png). A white block of recessed
// windows behind a grid of deep vertical fins (thick between bays, thin between
// the two windows of a bay), with a floor slab band and a sunshade ledge on every
// floor (some ledges carry AC units); a taller ground floor; on the front an
// entrance canopy with the signboard, dark granite columns and steps, which
// reaches beyond the footprint; a flat roof with a stair head, water tank and mast.
import { concrete, mix, rng } from "./atlas.mjs";
import { paintRoof } from "./style-screen.mjs";

export const regions = {
  cellA: [0, 0, 256, 192],
  cellB: [256, 0, 256, 192],
  cellC: [512, 0, 256, 192],
  ground: [768, 0, 256, 256],
  entrance: [0, 192, 512, 208],
  roof: [512, 192, 256, 208],
  sign: [0, 416, 1024, 128],
  fin: [0, 560, 64, 64],
  white: [64, 560, 64, 64],
  granite: [128, 560, 64, 64],
  step: [192, 560, 64, 64],
  roofbox: [256, 560, 64, 64],
  metal: [320, 560, 64, 64],
  cream: [384, 560, 64, 64]
};
const SWATCH = { fin: [228, 219, 196], white: [236, 234, 227], granite: [44, 44, 48], step: [60, 60, 64], roofbox: [206, 201, 190], metal: [112, 114, 117], cream: [214, 205, 182] };
export const swatches = Object.keys(SWATCH);

// One bay of one upper floor, bottom to top: slab, spandrel box, two windows,
// sunshade ledge, recessed band (ac: an outdoor AC unit on the left or right ledge).
function paintCell(atlas, region, ac, seed) {
  const [, , w, h] = region;
  const window = [[0.07, 0.43], [0.57, 0.93]];
  atlas.paint(region, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete([234, 226, 204], x, y, seed, 3, 5);
    if (v < 0.06) c = concrete([222, 213, 190], x, y, seed + 1, 3, 4);
    else if (v > 0.76) { c = concrete([206, 197, 174], x, y, seed + 2, 3, 5); if (v > 0.93) c = mix(c, [150, 142, 124], (v - 0.93) / 0.07 * 0.6); }
    else if (v > 0.72) c = [168, 160, 142]; // under the ledge
    else if (v > 0.27 && v < 0.3) c = [200, 191, 168]; // sill shadow
    for (const [w0, w1] of window) {
      if (u < w0 || u > w1 || v < 0.3 || v > 0.72) continue;
      const fu = (u - w0) / (w1 - w0), fv = (v - 0.3) / 0.42;
      const frame = fu < 0.05 || fu > 0.95 || fv < 0.06 || fv > 0.94 || Math.abs(fu - 0.5) < 0.025;
      c = frame ? [150, 148, 142] : mix([56, 58, 62], [88, 90, 94], fv);
    }
    if (ac) {
      const [a0, a1] = ac === "left" ? [0.12, 0.34] : [0.66, 0.88];
      if (u > a0 && u < a1 && v > 0.765 && v < 0.93) {
        c = [222, 222, 216];
        const cu = (u - a0) / (a1 - a0), cv = (v - 0.765) / 0.165;
        if (Math.hypot((cu - 0.35) * 1.6, cv - 0.5) < 0.33) c = [92, 92, 94];
        if (cu > 0.97 || cv < 0.05) c = [180, 180, 176];
      }
    }
    return c;
  });
}

// Ground-floor bay (4 m): plinth, two tall windows, band under the first slab.
function paintGround(atlas) {
  const [, , w, h] = regions.ground;
  atlas.paint(regions.ground, (x, y) => {
    const u = x / w, metres = (1 - y / h) * 4.0;
    let c = metres < 0.5 ? concrete([202, 198, 190], x, y, 81) : concrete([232, 224, 202], x, y, 82, 3, 5);
    for (const [w0, w1] of [[0.07, 0.43], [0.57, 0.93]]) {
      if (u < w0 || u > w1 || metres < 0.8 || metres > 3.2) continue;
      const fu = (u - w0) / (w1 - w0), fv = (metres - 0.8) / 2.4;
      const frame = fu < 0.05 || fu > 0.95 || fv < 0.04 || fv > 0.96 || Math.abs(fu - 0.5) < 0.025 || Math.abs(fv - 0.7) < 0.02;
      c = frame ? [150, 148, 142] : mix([50, 52, 56], [84, 86, 90], fv);
    }
    return c;
  });
}

// Glass entrance under the canopy: dark glazing, frames, doors and lights inside.
function paintEntrance(atlas) {
  const [, , w, h] = regions.entrance;
  atlas.paint(regions.entrance, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = mix([28, 30, 34], [44, 48, 54], v);
    if (Math.abs((u * 8) % 1 - 0.5) > 0.47 || v > 0.97 || Math.abs(v - 0.78) < 0.012) c = [74, 76, 80]; // mullions, transom
    if (u > 0.38 && u < 0.62 && v < 0.78 && Math.abs(u - 0.5) < 0.006) c = [90, 92, 96]; // door meeting line
    if (Math.abs(v - 0.86) < 0.03 && Math.abs((u * 5) % 1 - 0.5) < 0.08) c = [214, 196, 150]; // lights inside
    return c;
  });
}

// Signboard from photo 1 (the tree in front of it is painted out with the board's
// navy; the text it hides is not guessed), or the building's Bangla name.
async function paintSign(atlas, { spec, feature, photo }) {
  const sign = spec.sign || {};
  const navy = [56, 60, 104];
  if (sign.photo && await atlas.photo(regions.sign, photo(sign.photo), sign.quad)) {
    // Foliage (greener than blue) and a 2 px fringe around it become the board
    // colour measured from the photo (median of the dark bluish pixels).
    const [x0, y0, w, h] = regions.sign;
    const board = [[], [], []];
    const foliage = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const c = atlas.get(x0 + x, y0 + y);
      if (c[1] > c[2] + 2) foliage[y * w + x] = 1;
      else if (c[2] > c[1] + 12 && c[0] + c[1] + c[2] < 330) c.forEach((v, k) => board[k].push(v));
    }
    const median = board.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0);
    const color = board[0].length > 50 ? median : navy;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy += 1) for (let dx = -2; dx <= 2 && !near; dx += 1) near = foliage[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))] === 1;
      if (near) atlas.put(x0 + x, y0 + y, concrete(color, x, y, 92, 3, 3));
    }
    return;
  }
  if (sign.photo) console.warn(`  ${sign.photo} not found: drawing the signboard from the building's name.`);
  atlas.paint(regions.sign, (x, y) => concrete(navy, x, y, 91, 2, 3));
  const p = feature.properties;
  await atlas.text(regions.sign, [{ text: p.name_bn || p.name_en || "", height: 0.55, top: 0.2, color: "#d8dce6", bold: true }]);
}

export async function paint(atlas, ctx) {
  paintCell(atlas, regions.cellA, null, 11);
  paintCell(atlas, regions.cellB, "left", 13);
  paintCell(atlas, regions.cellC, "right", 15);
  paintGround(atlas);
  paintEntrance(atlas);
  paintRoof(atlas, regions.roof);
  for (const [name, color] of Object.entries(SWATCH)) atlas.paint(regions[name], (x, y) => concrete(color, x, y, 60, 2, 0));
  await paintSign(atlas, ctx);
}

export function build(mesh, { W, D, H, entranceOffset, spec }) {
  const { fbox, box, SIDES } = mesh;
  const GROUND = spec.groundHeight ?? 4.0;
  const PARAPET = 0.9;
  const FACE = 0.9; // window plane behind the fin fronts
  const CORNER = FACE + 0.2; // corner columns (front and back sides), also the parapet depth
  const FIN_HALF = 0.275, THIN_HALF = 0.15, THIN_D = 0.3, BAND_D = 0.12, LEDGE_D = 0.35;
  const upper = H - GROUND - PARAPET;
  const floors = Math.max(1, Math.round(upper / (spec.floorHeight ?? 3.2)));
  const f = upper / floors;
  const CANOPY = { y0: 3.4, y1: 4.5, out: 3.0 };
  const random = rng(5);
  const cells = ["cellA", "cellA", "cellA", "cellB", "cellC"];

  for (const side of Object.keys(SIDES)) {
    const { S } = SIDES[side];
    const cornered = side === "front" || side === "back";
    const inner = [CORNER, S - CORNER];
    const n = Math.max(2, Math.round((inner[1] - inner[0]) / (spec.bay ?? 3.9)));
    const m = (inner[1] - inner[0]) / n;
    const bay = (k) => [inner[0] + k * m + (k > 0 ? FIN_HALF : 0), inner[0] + (k + 1) * m - (k < n - 1 ? FIN_HALF : 0)];

    // Entrance bays (front): the bay with the entrance and its nearer neighbour.
    let door = null;
    if (side === "front") {
      const ae = W / 2 + entranceOffset;
      const k = Math.max(0, Math.min(n - 1, Math.floor((ae - inner[0]) / m)));
      const k2 = Math.max(0, Math.min(n - 1, ae - (inner[0] + (k + 0.5) * m) > 0 ? k + 1 : k - 1));
      door = { from: Math.min(k, k2), to: Math.max(k, k2) };
      door.a = [bay(door.from)[0], bay(door.to)[1]];
      door.canopy = [inner[0] + door.from * m - 0.6, inner[0] + (door.to + 1) * m + 0.6];
    }
    const underCanopy = (a) => door && a > door.a[0] && a < door.a[1]; // fins between the entrance bays

    // Fins: corner columns on the front and back, thick fins between bays.
    if (cornered) {
      fbox(side, [0, CORNER], [0, H], [0, CORNER], "olrt", "fin");
      fbox(side, [S - CORNER, S], [0, H], [0, CORNER], "olrt", "fin");
    }
    for (let k = 1; k < n; k += 1) {
      const a = inner[0] + k * m;
      fbox(side, [a - FIN_HALF, a + FIN_HALF], [underCanopy(a) ? CANOPY.y1 : 0, H], [0, FACE], "olrt", "fin");
    }
    // Bays: windows of every floor, thin fins, ground floor.
    for (let k = 0; k < n; k += 1) {
      const [a0, a1] = bay(k);
      for (let i = 0; i < floors; i += 1) {
        const y = GROUND + i * f;
        fbox(side, [a0, a1], [y, y + f], [FACE, FACE + 0.1], "o", cells[Math.floor(random() * cells.length)], 0.82);
      }
      const mid = (a0 + a1) / 2;
      fbox(side, [mid - THIN_HALF, mid + THIN_HALF], [GROUND, H - PARAPET], [THIN_D, FACE], "olr", "fin", 0.95);
      if (!door || k < door.from || k > door.to) fbox(side, [a0, a1], [0, GROUND], [FACE, FACE + 0.1], "o", "ground", 0.85);
    }
    // Slab bands and sunshade ledges run across the side (through the fins).
    for (let i = 0; i < floors; i += 1) {
      const y = GROUND + i * f;
      fbox(side, inner, [y, y + 0.18], [BAND_D, FACE], "otb", "fin", 1);
      fbox(side, inner, [y + 0.72 * f, y + 0.72 * f + 0.08], [LEDGE_D, FACE], "otb", "fin", 0.95);
    }
    fbox(side, inner, [H - PARAPET, H], [BAND_D, CORNER], "oti", "fin", 1);

    if (door) {
      // Entrance: glazing, band above it, canopy with the signboard, columns, steps.
      fbox(side, door.a, [0.75, CANOPY.y0], [FACE, FACE + 0.1], "o", "entrance", 0.95);
      fbox(side, door.a, [CANOPY.y0, GROUND], [FACE, FACE + 0.1], "o", "cream", 0.85);
      fbox(side, door.canopy, [CANOPY.y0, CANOPY.y1], [-CANOPY.out, FACE], "o", "sign", 1);
      fbox(side, door.canopy, [CANOPY.y0, CANOPY.y1], [-CANOPY.out, FACE], "b", "white", 0.95);
      fbox(side, door.canopy, [CANOPY.y0, CANOPY.y1], [-CANOPY.out, FACE], "t", "cream", 1);
      fbox(side, door.canopy, [CANOPY.y0, CANOPY.y1], [-CANOPY.out, FACE], "lr", "granite", 1);
      for (const a of [door.canopy[0], door.canopy[1] - 0.6]) fbox(side, [a, a + 0.6], [0, CANOPY.y0], [-CANOPY.out, -CANOPY.out + 0.6], "oilr", "granite", 1);
      for (let s = 0; s < 5; s += 1) fbox(side, [door.canopy[0] + 0.6, door.canopy[1] - 0.6], [0.15 * s, 0.15 * (s + 1)], [-CANOPY.out + 0.6 * s, FACE], "otlr", "step", 0.95);
    }
  }

  // Roof with a stair head, a water tank on it, and the mast.
  const roofY = H - PARAPET + 0.1;
  const rx = W / 2 - CORNER, rz = D / 2 - CORNER;
  mesh.rect([0, roofY, 0], [0, 1, 0], [1, 0, 0], rx * 2, rz * 2, "roof", 1);
  const head = { x: [-W / 2 + 3, -W / 2 + 9], z: [-D / 2 + 3, -D / 2 + 8] };
  box(head.x, [roofY, roofY + 3], head.z, "+z -z +x -x +y", "roofbox", 0.95);
  box([head.x[0] + 1, head.x[0] + 4], [roofY + 3, roofY + 4.4], [head.z[0] + 0.8, head.z[0] + 3.8], "+z -z +x -x +y", "roofbox", 1);
  box([-0.08, 0.08], [roofY, roofY + 9], [D / 2 - 4, D / 2 - 3.84], "+z -z +x -x +y", "metal", 1);
}
