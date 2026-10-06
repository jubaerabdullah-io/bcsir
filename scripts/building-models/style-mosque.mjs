// "mosque" style: the BCSIR Central Mosque (reference photos
// backup/models/source/mosque/). A white two-storey prayer hall on the footprint
// rectangle with green trim: on the front (entrance side) cusped (multifoil)
// arches with leaf-pattern jali on both floors, green columns, iron grille doors
// with the red carpet inside, a tiled dado, and a green steel canopy with a
// corrugated roof over the forecourt; the other sides are cream with rows of narrow
// pointed-arch windows and AC units. On top: a green band, a parapet of pointed
// merlons (cut out of the texture; white in front, perforated grey elsewhere),
// slender white posts, the signboard with the Bangla name, the "Allah"
// calligraphy plate and the red clock, and the loudspeaker mast.
import { concrete, hash, mix, scale, valueNoise } from "./atlas.mjs";

export const regions = {
  upper: [0, 0, 256, 304],
  ground: [256, 0, 256, 304],
  door: [512, 0, 256, 304],
  lancet: [768, 0, 256, 304],
  plain: [0, 304, 256, 304],
  merlonFront: [256, 304, 384, 96],
  merlonBack: [640, 304, 384, 96],
  canopy: [256, 400, 256, 128],
  floor: [512, 400, 256, 128],
  sign: [0, 624, 768, 112],
  allah: [768, 528, 256, 96],
  clock: [768, 624, 128, 48],
  white: [512, 528, 64, 64],
  green: [576, 528, 64, 64],
  cream: [640, 528, 64, 64],
  dark: [704, 528, 64, 64],
  steel: [256, 528, 64, 64],
  post: [320, 528, 64, 64]
};
const SWATCH = { white: [240, 240, 236], green: [22, 150, 76], cream: [228, 222, 196], dark: [46, 50, 54], steel: [38, 120, 70], post: [232, 232, 226] };
export const swatches = Object.keys(SWATCH);
const GREEN = [22, 150, 76], WHITE = [240, 240, 236];

// ---- Texture -------------------------------------------------------------------------
// Cusped arch of a bay (metres in the bay: width bw, height bh): the opening between
// x0..x1, straight sides up to the spring ys, a pointed arch with lobes up to the apex.
function cuspedArch(x0, x1, ys) {
  const span = x1 - x0, c = (x0 + x1) / 2;
  const r = span * 0.62; // arcs centred inside the opposite half: a slightly pointed arch
  const rho = span * 0.13; // lobe radius: the scallops of the outline
  const lobes = [];
  const n = 4;
  for (let side = -1; side <= 1; side += 2) {
    const cx = c - side * (r - span / 2); // centre of this side's arc
    for (let k = 0; k <= n; k += 1) {
      const a = (k / n) * Math.acos((r - span / 2) / r); // from the spring to the apex
      const rr = r - rho * 0.35;
      lobes.push([cx + side * rr * Math.cos(a), ys + rr * Math.sin(a)]);
    }
  }
  const insideArch = (x, y, grow) => {
    if (y < ys) return x > x0 - grow && x < x1 + grow;
    const dl = Math.hypot(x - (c + (r - span / 2)), y - ys), dr = Math.hypot(x - (c - (r - span / 2)), y - ys);
    return dl < r - rho + grow && dr < r - rho + grow;
  };
  const inside = (x, y, grow = 0) => insideArch(x, y, grow) || (y >= ys && lobes.some(([lx, ly]) => Math.hypot(x - lx, y - ly) < rho + grow));
  return { inside, apex: ys + Math.sqrt(r * r - (r - span / 2) ** 2) };
}

// A bay with a cusped arch: leaf jali in the arch, a grille (upper) or lit glass
// (ground) below; wall colour and dado for the ground floor.
function paintCusped(atlas, region, { lit = false, dado = false, door = false, seed }) {
  const [, , w, h] = region;
  const bw = 3.0, bh = 3.8;
  const x0 = 0.3, x1 = bw - 0.3, ys = door ? 2.25 : 2.0;
  const arch = cuspedArch(x0, x1, ys);
  atlas.paint(region, (px, py) => {
    const x = (px / w) * bw, y = (1 - py / h) * bh;
    let c = concrete(WHITE, px, py, seed, 2, 4);
    if (x < 0.14 || x > bw - 0.14) c = scale(c, 0.97); // pilaster edges
    if (x > 0.14 && x < 0.19 || x > bw - 0.19 && x < bw - 0.14) c = GREEN;
    const bottom = dado ? 1.05 : 0.35;
    if (dado && y < bottom) {
      // Pink and white tiles, a pointed-arch tile panel per metre.
      const u = (x % 0.75) / 0.75, top = 0.62 + 0.28 * (1 - Math.abs(u - 0.5) * 2);
      c = y < top && u > 0.12 && u < 0.88 ? mix([246, 244, 238], [196, 204, 214], valueNoise(px, py, 5, seed) * 0.6) : mix([222, 150, 116], [240, 178, 140], hash(Math.floor(x / 0.12), Math.floor(y / 0.12), seed));
    }
    if (arch.inside(x, y, 0.07) && !arch.inside(x, y) && y > bottom) c = GREEN; // green outline
    if (arch.inside(x, y) && y > bottom) {
      if (y >= ys) {
        // Leaf jali: chevron veins round a central stem.
        const dx = Math.abs(x - bw / 2), t = (y - ys) - dx * 0.75;
        const vein = dx < 0.03 || ((t % 0.3) + 0.3) % 0.3 < 0.035 || Math.abs(dx - (y - ys) * 0.55) < 0.025;
        c = vein ? [236, 240, 236] : lit ? mix([206, 214, 190], [168, 190, 168], (y - ys) / 1.5) : mix([112, 122, 124], [150, 160, 162], (y - ys) / 1.5);
      } else if (door) {
        // Iron grille door; the red carpet shows at the bottom.
        c = y < bottom + 0.35 ? [196, 34, 40] : mix([214, 206, 188], [150, 140, 120], (y - bottom) / (ys - bottom));
        const gu = ((x - x0) / 0.16) % 1, gv = ((y - bottom) / 0.16) % 1;
        if (gu < 0.22 || gv < 0.22 || Math.abs(gu - gv) < 0.12) c = [30, 32, 34];
        if (Math.abs(x - bw / 2) < 0.05) c = [24, 26, 28];
      } else if (lit) {
        c = mix([236, 238, 226], [206, 216, 200], (y - bottom) / (ys - bottom)); // lit glass
        const gu = ((x - x0) / 0.62) % 1;
        if (gu < 0.03 || Math.abs(y - (bottom + ys) / 2) < 0.02) c = [150, 160, 150];
      } else {
        c = mix([60, 64, 66], [92, 98, 100], (y - bottom) / (ys - bottom)); // grille window
        const gu = ((x - x0) / 0.14) % 1, gv = ((y - bottom) / 0.14) % 1;
        if (gu < 0.25 || gv < 0.25) c = [176, 180, 180];
      }
    }
    if (y > bh - 0.22) c = GREEN; // band under the next floor
    return c;
  });
}

// Back and sides: cream wall with three narrow pointed-arch windows.
function paintLancet(atlas) {
  const [, , w, h] = regions.lancet;
  const bw = 3.0, bh = 3.8;
  atlas.paint(regions.lancet, (px, py) => {
    const x = (px / w) * bw, y = (1 - py / h) * bh;
    let c = concrete([230, 224, 198], px, py, 41, 3, 6);
    for (let k = 0; k < 3; k += 1) {
      const cx = 0.6 + k * 0.9, half = 0.3, ys = 2.6, top = 3.25;
      const inArch = (g) => Math.abs(x - cx) < half + g && y > 1.0 - g && (y < ys || Math.abs(x - cx) < (half + g) * Math.max(0, 1 - ((y - ys) / (top - ys + g)) ** 1.6));
      if (inArch(0.06) && !inArch(0)) c = GREEN;
      if (inArch(0)) {
        c = mix([58, 62, 64], [96, 100, 102], (y - 1) / 2.2);
        if (Math.abs(x - cx) < 0.02 || ((y - 1) % 0.45) < 0.03) c = [168, 170, 166];
      }
    }
    if (y < 0.95 && y > 0.88) c = GREEN; // sill line
    if (y > bh - 0.2) c = GREEN;
    return c;
  });
}

function paintPlain(atlas) {
  const [, , w, h] = regions.plain;
  atlas.paint(regions.plain, (px, py) => {
    const x = (px / w) * 3.0, y = (1 - py / h) * 3.8;
    let c = concrete([230, 224, 198], px, py, 43, 3, 7);
    if (y < 0.3) c = scale(c, 0.9);
    if (x > 1.0 && x < 2.0 && y > 1.5 && y < 2.4) c = Math.abs(x - 1.5) < 0.02 || x < 1.04 || x > 1.96 || y < 1.54 || y > 2.36 ? [150, 146, 132] : [70, 74, 76]; // small window
    if (y > 3.58) c = GREEN;
    return c;
  });
}

// Parapet of pointed merlons (1.2 m each; transparent between their points).
function paintMerlons(atlas, region, front) {
  const [, , w, h] = region;
  atlas.paint(region, (px, py) => {
    const x = (px / w) * 4.8, y = (1 - py / h) * 1.2; // 4 merlons across the region
    const u = x % 1.2;
    const shoulder = 0.62, apex = 1.18;
    const halfAt = y < shoulder ? 0.55 : 0.55 * Math.max(0, 1 - (y - shoulder) / (apex - shoulder));
    const d = Math.abs(u - 0.6);
    if (d > halfAt) return [...(front ? WHITE : [196, 196, 188]), 0];
    const edge = halfAt - d < 0.05 || y < 0.05;
    if (edge) return GREEN;
    let c = front ? concrete(WHITE, px, py, 51, 2, 3) : concrete([200, 198, 190], px, py, 53, 4, 10);
    if (!front && Math.abs(((u - 0.6) / 0.16) % 1) < 0.35 && ((y / 0.16) % 1) < 0.4 && y > 0.15 && y < shoulder + 0.25 && d < halfAt - 0.1) c = [72, 74, 72]; // perforations
    return c;
  });
}

function paintCanopy(atlas) {
  atlas.paint(regions.canopy, (px, py, w) => {
    const ridge = (px % 12) / 12;
    return scale([150, 172, 160], 0.86 + 0.18 * Math.abs(Math.sin(ridge * Math.PI)) + (valueNoise(px, py, 30, 61) - 0.5) * 0.06);
  });
}

function paintFloor(atlas) {
  atlas.paint(regions.floor, (px, py) => {
    if (py % 32 < 1.5) return [70, 66, 62]; // dark lines between the prayer rows
    return mix([232, 222, 208], [246, 240, 230], valueNoise(px, py, 40, 71));
  });
}

async function paintSigns(atlas) {
  const [, , sw, sh] = regions.sign;
  atlas.paint(regions.sign, (x, y) => (x < 4 || y < 4 || x >= sw - 4 || y >= sh - 4 ? [200, 206, 200] : concrete([244, 244, 240], x, y, 81, 1, 2)));
  // The name as on the building (photos): "BCSIR Central Jame Masjid".
  await atlas.text(regions.sign, [{ text: "বিসিএসআইআর কেন্দ্রীয় জামে মসজিদ", height: 0.62, top: 0.18, color: "#138a45", bold: true, maxWidth: 0.92 }]);
  atlas.paint(regions.allah, (x, y) => concrete([244, 244, 240], x, y, 83, 1, 2));
  await atlas.text(regions.allah, [{ text: "الله", height: 0.7, top: 0.12, color: "#138a45", bold: true, font: "Segoe UI", maxWidth: 0.8 }]);
  atlas.paint(regions.clock, () => [24, 22, 22]);
  await atlas.text(regions.clock, [{ text: "5:25", height: 0.7, top: 0.14, color: "#ff3030", bold: true, font: "Arial", maxWidth: 0.7 }]);
}

export async function paint(atlas) {
  paintCusped(atlas, regions.upper, { seed: 11 });
  paintCusped(atlas, regions.ground, { lit: true, dado: true, seed: 13 });
  paintCusped(atlas, regions.door, { lit: true, dado: true, door: true, seed: 15 });
  paintLancet(atlas);
  paintPlain(atlas);
  paintMerlons(atlas, regions.merlonFront, true);
  paintMerlons(atlas, regions.merlonBack, false);
  paintCanopy(atlas);
  paintFloor(atlas);
  for (const [name, color] of Object.entries(SWATCH)) atlas.paint(regions[name], (x, y) => concrete(color, x, y, 60, 2, 0));
  await paintSigns(atlas);
}

// ---- Geometry ------------------------------------------------------------------------
export function build(mesh, { W, D, H, entranceOffset }) {
  const { fbox, box, SIDES, span, isEnd } = mesh;
  const G = 3.8, F = 7.6; // top of the ground floor, top of the upper floor
  const BAND = [F, F + 0.45], ROOF = F + 0.35, MERLON = [BAND[1], BAND[1] + 1.2];

  for (const side of Object.keys(SIDES)) {
    const { S } = SIDES[side];
    const front = side === "front";
    const n = Math.max(2, Math.round(S / 3.0)), m = S / n;
    const doorBay = front ? Math.max(0, Math.min(n - 1, Math.floor((W / 2 + entranceOffset) / m))) : -1;
    for (let k = 0; k < n; k += 1) {
      const [a0, a1] = [k * m, (k + 1) * m];
      if (front) {
        fbox(side, [a0, a1], [0, G], [0.25, 0.35], "o", k === doorBay || k === doorBay - 1 ? "door" : "ground", 0.92);
        fbox(side, [a0, a1], [G, F], [0.1, 0.2], "o", "upper", 0.92);
      } else {
        fbox(side, [a0, a1], [0, G], [0, 0.1], "o", "plain", 0.9);
        fbox(side, [a0, a1], [G, F], [0, 0.1], "o", "lancet", 0.9);
        // Outdoor AC units along the ground floor, every other bay.
        if (k % 2 === 1) fbox(side, [a0 + 0.9, a0 + 1.8], [0.3, 1.0], [-0.45, 0], "otlr", "white", 0.95);
      }
    }
    if (front) {
      // Green columns and the green band between the floors; white pilasters above.
      for (let k = 0; k <= n; k += 1) {
        const a = k * m;
        fbox(side, [Math.max(0, a - 0.14), Math.min(S, a + 0.14)], [0, G], [0, 0.25], "o" + (k > 0 ? "l" : "") + (k < n ? "r" : ""), "green", 1);
        fbox(side, [Math.max(0, a - 0.16), Math.min(S, a + 0.16)], [G, F], [0, 0.1], "o" + (k > 0 ? "l" : "") + (k < n ? "r" : ""), "white", 1);
      }
      fbox(side, [0, S], [G - 0.05, G + 0.2], [-0.12, 0.1], "otb", "green", 1);
    }
    // Band, merlons (both sides of a thin parapet), inner parapet face.
    fbox(side, isEnd(side) ? [-0.1, S + 0.1] : [0, S], BAND, [-0.1, 0], "otb" + (isEnd(side) ? "lr" : ""), "green", 1);
    const count = Math.max(1, Math.round(S / 4.8)), step = S / count;
    for (let k = 0; k < count; k += 1) {
      fbox(side, [k * step, (k + 1) * step], MERLON, [0.02, 0.04], "o", front ? "merlonFront" : "merlonBack", 1);
    }
    fbox(side, span(side, 0), [ROOF, BAND[1]], [0, 0.2], "i", "cream", 0.85);
    // Slender white posts through the parapet at the corners and every ~6 m.
    const posts = Math.max(1, Math.round(S / 6));
    for (let k = 0; k <= posts; k += 1) {
      const a = Math.min(S - 0.2, Math.max(0.2, (k * S) / posts));
      if (isEnd(side) && (k === 0 || k === posts)) continue; // corner posts belong to the front and back
      fbox(side, [a - 0.18, a + 0.18], [BAND[1], H - 0.15], [-0.05, 0.31], "oilr", "post", 1);
      fbox(side, [a - 0.22, a + 0.22], [H - 0.15, H], [-0.09, 0.35], "oilrt", "white", 1);
    }
  }

  const front = SIDES.front, ae = W / 2 + entranceOffset;
  // Steel canopy over the forecourt: green posts, beams, a sloped corrugated roof.
  const c0 = 0.4, c1 = W - 0.4, out = 4.2;
  for (let a = c0; a <= c1 + 0.01; a += (c1 - c0) / Math.max(1, Math.round((c1 - c0) / 4))) fbox("front", [a - 0.08, a + 0.08], [0, 3.35], [-out, -out + 0.16], "oilr", "steel", 1);
  fbox("front", [c0, c1], [3.3, 3.45], [-out, -out + 0.16], "otb", "steel", 1);
  const P = (a, y, d) => front.at(a, y, d);
  mesh.face([P(c0, 3.45, -out), P(c1, 3.45, -out), P(c1, 3.95, 0.05), P(c0, 3.95, 0.05)], [0, 0.99, 0.12], "canopy", 1);
  mesh.face([P(c0, 3.4, -out), P(c1, 3.4, -out), P(c1, 3.9, 0.05), P(c0, 3.9, 0.05)], [0, -0.99, -0.12], "steel", 0.7);
  // Tiled forecourt under the canopy.
  fbox("front", [c0, c1], [0, 0.04], [-out, 0], "t", "floor", 1);

  // Signboard with the "Allah" plate over it and the clock below, at the roof front.
  fbox("front", [ae - 3.6, ae + 3.6], [MERLON[0] + 0.05, MERLON[0] + 1.1], [-0.35, -0.25], "o", "sign", 1);
  fbox("front", [ae - 3.6, ae + 3.6], [MERLON[0] + 0.05, MERLON[0] + 1.1], [-0.35, -0.25], "itlr", "white", 0.9);
  fbox("front", [ae - 1.1, ae + 1.1], [MERLON[0] + 1.1, MERLON[0] + 1.8], [-0.3, -0.22], "o", "allah", 1);
  fbox("front", [ae - 1.1, ae + 1.1], [MERLON[0] + 1.1, MERLON[0] + 1.8], [-0.3, -0.22], "itlr", "white", 0.9);
  fbox("front", [ae - 0.45, ae + 0.45], [F - 0.55, F - 0.1], [-0.08, 0.1], "o", "clock", 1);

  // Roof and the loudspeaker mast with horns.
  mesh.rect([0, ROOF, 0], [0, 1, 0], [1, 0, 0], W - 0.3, D - 0.3, "cream", 0.9);
  const mx = -W / 2 + ae + 1.5, mz = D / 2 - 3.5;
  box([mx - 0.06, mx + 0.06], [ROOF, ROOF + 6.5], [mz - 0.06, mz + 0.06], "+z -z +x -x", "dark", 1);
  for (const [dx, dz] of [[0, 0.5], [0.45, -0.25], [-0.45, -0.25]]) box([mx + dx - 0.15, mx + dx + 0.15], [ROOF + 5.6, ROOF + 5.95], [mz + dz - 0.15, mz + dz + 0.15], "+z -z +x -x +y", "white", 1);
}
