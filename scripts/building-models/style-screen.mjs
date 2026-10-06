// "screen" style: IGCRT and IFST (reference photos backup/models/source/igcrt/).
// A perforated off-white screen of 4 rows of panels on a structural grid, hung
// in front of the upper floors (a slot open to the sky between them); a recessed
// ground floor with window bays, pilasters and beams; on the front a central
// entrance with steps, a signboard and a brick planter wall; a flat roof behind
// the parapet and, optionally, a courtyard.
import { concrete, mix, rng, scale, valueNoise, hash } from "./atlas.mjs";
import { cross, Y } from "./mesh.mjs";

export const regions = {
  panel: [0, 0, 512, 416],
  bay: [512, 0, 256, 384],
  court: [768, 0, 256, 384],
  sign: [0, 416, 1024, 144],
  door: [0, 560, 256, 256],
  brick: [256, 560, 512, 64],
  roof: [256, 624, 256, 256],
  lawn: [512, 624, 128, 128],
  white: [640, 624, 64, 64],
  soffit: [704, 624, 64, 64],
  dark: [768, 624, 64, 64],
  stone: [832, 624, 64, 64],
  pier: [896, 624, 64, 64],
  metal: [960, 624, 64, 64],
  cream: [640, 688, 64, 64],
  paving: [704, 688, 64, 64]
};
const SWATCH = { white: [236, 234, 227], soffit: [152, 150, 144], dark: [72, 73, 72], stone: [198, 195, 188], pier: [188, 118, 76], metal: [86, 90, 92], cream: [229, 223, 206], paving: [184, 181, 173] };
export const swatches = Object.keys(SWATCH);

// ---- Texture -------------------------------------------------------------------------
function paintPanel(atlas) {
  const [, , w, h] = regions.panel;
  const margin = 12, cols = 18, rows = 13;
  const px = (w - 2 * margin) / cols, py = (h - 2 * margin) / rows;
  const hw = px * 0.66, hh = py * 0.44;
  const random = rng(7);
  const holeTone = Array.from({ length: cols * rows }, () => 0.9 + random() * 0.2);
  atlas.paint(regions.panel, (x, y) => {
    let c = concrete([231, 228, 219], x, y, 11, 5, 7);
    const cx = Math.floor((x - margin) / px), cy = Math.floor((y - margin) / py);
    if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) {
      const lx = x - margin - cx * px - (px - hw) / 2, ly = y - margin - cy * py - (py - hh) / 2;
      if (lx >= 0 && ly >= 0 && lx < hw && ly < hh) {
        c = scale(mix([70, 72, 74], [124, 126, 126], Math.min(1, (ly / hh) * 1.3)), holeTone[cy * cols + cx]);
        if (ly > hh - 2) c = [172, 170, 162]; // sill catching the light
      } else if (lx >= -1.5 && lx < hw + 1.5 && ly >= -1.5 && ly < 0) c = scale(c, 0.86);
    }
    return c;
  });
}

// Bay with a window of panes; wall grooved below, darkening towards the ceiling above.
export function paintBay(atlas, region, { windowY = [0.95, 3.35], windowX = [0.25, 3.1], panes = [4, 3], width = 3.35, height = 5.0, wall = [229, 223, 206], seed = 21, grooves = true } = {}) {
  const [, , w, h] = region;
  const sx = w / width, sy = h / height;
  const wx0 = windowX[0] * sx, wx1 = windowX[1] * sx, wy0 = h - windowY[1] * sy, wy1 = h - windowY[0] * sy;
  const frame = 5, mullion = 4;
  atlas.paint(region, (x, y) => {
    const metresUp = (h - y) / sy;
    let c = concrete(wall, x, y, seed, 3, 5);
    if (grooves && metresUp < windowY[0] && x % 14 === 0) c = scale(c, 0.9);
    if (metresUp > windowY[1]) c = scale(c, 1 - 0.22 * Math.min(1, (metresUp - windowY[1]) / (height - windowY[1])));
    if (x >= wx0 && x < wx1 && y >= wy0 && y < wy1) {
      const fx = x - wx0, fy = y - wy0, ww = wx1 - wx0, wh = wy1 - wy0;
      const paneW = (ww - 2 * frame) / panes[0], paneH = (wh - 2 * frame) / panes[1];
      const inFrame = fx < frame || fy < frame || fx >= ww - frame || fy >= wh - frame;
      const mx = (fx - frame) % paneW, my = (fy - frame) % paneH;
      const inMullion = mx < mullion / 2 || mx > paneW - mullion / 2 || my < mullion / 2 || my > paneH - mullion / 2;
      if (inFrame || inMullion) c = [238, 238, 233];
      else {
        c = mix([80, 94, 102], [42, 52, 58], fy / wh);
        const glint = Math.max(0, 1 - Math.abs((fx - fy * 0.8) / ww - 0.35) * 6);
        c = mix(c, [120, 134, 142], glint * 0.35);
      }
    }
    if (y >= wy1 && y < wy1 + 3 && x >= wx0 - 2 && x < wx1 + 2) c = [242, 240, 234];
    return c;
  });
}

function paintDoor(atlas) {
  const [, , w, h] = regions.door;
  atlas.paint(regions.door, (x, y) => {
    const u = x / w, v = y / h;
    let c = [30, 28, 26];
    if (u > 0.36 && u < 0.64 && v > 0.45) c = mix([66, 96, 58], [120, 150, 96], valueNoise(x, y, 6, 3)); // courtyard beyond
    if (u > 0.36 && u < 0.64 && v > 0.45 && v < 0.5) c = [150, 160, 150];
    if (u < 0.1 || u > 0.9) c = [60, 45, 36];
    if (v < 0.16) c = [36, 42, 48];
    if (u < 0.035 || u > 0.965 || v < 0.035) c = [96, 88, 80];
    return c;
  });
}

function paintBrick(atlas) {
  const [, , , h] = regions.brick;
  const course = 7, brick = 21;
  atlas.paint(regions.brick, (x, y) => {
    if (y < 6) return concrete([204, 200, 192], x, y, 31);
    if (y >= h - 5) return concrete([176, 172, 164], x, y, 32);
    const row = Math.floor((y - 6) / course);
    const bx = x + (row % 2 ? brick / 2 : 0);
    if ((y - 6) % course === 0 || Math.floor(bx) % brick === 0) return [214, 197, 172];
    return scale([198, 128, 84], 0.9 + hash(Math.floor(bx / brick), row, 33) * 0.18);
  });
}

export function paintRoof(atlas, region = regions.roof) {
  atlas.paint(region, (x, y) => {
    let c = concrete([150, 149, 144], x, y, 41, 5, 9);
    c = scale(c, 1 - 0.08 * Math.max(0, valueNoise(x, y, 40, 42) - 0.55) / 0.45);
    if (x % 42 === 0 || y % 42 === 0) c = scale(c, 0.95);
    return c;
  });
}

function paintLawn(atlas) {
  const [, , w, h] = regions.lawn;
  atlas.paint(regions.lawn, (x, y) => {
    const border = x < 6 || y < 6 || x >= w - 6 || y >= h - 6;
    const path = Math.abs(x - w / 2) < 5 || Math.abs(y - h / 2) < 4;
    return border || path ? concrete([174, 170, 156], x, y, 51) : concrete([98, 134, 72], x, y, 52, 14, 20);
  });
}

// The building's names from BuildingBoundary on a blue board (the IGCRT sign's look).
export async function paintNameSign(atlas, region, feature) {
  const p = feature.properties;
  atlas.paint(region, (x, y, w, h) => {
    const c = mix([36, 110, 178], [26, 86, 150], y / h);
    return x < 6 || y < 6 || x >= w - 6 || y >= h - 6 ? [220, 226, 232] : concrete(c, x, y, 71, 2, 4);
  });
  const english = `${String(p.name_en || "").toUpperCase()}${p.name_en_short ? ` (${p.name_en_short})` : ""}`;
  await atlas.text(region, [
    { text: english, height: 0.3, top: 0.1, bold: true, font: "Arial" },
    ...(p.name_bn ? [{ text: p.name_bn, height: 0.26, top: 0.42, bold: true }] : []),
    { text: "Bangladesh Council of Scientific and Industrial Research (BCSIR)", height: 0.2, top: 0.74, font: "Arial" }
  ]);
}

// Signboard: a photo crop (sign.photo + sign.quad) or, without a photo, the names.
async function paintSign(atlas, { spec, feature, photo }) {
  const sign = spec.sign || {};
  if (sign.photo && await atlas.photo(regions.sign, photo(sign.photo), sign.quad)) return;
  if (sign.photo) console.warn(`  ${sign.photo} not found: drawing the signboard from the building's names.`);
  await paintNameSign(atlas, regions.sign, feature);
}

export async function paint(atlas, ctx) {
  paintPanel(atlas);
  paintBay(atlas, regions.bay);
  paintBay(atlas, regions.court, { windowY: [1.1, 3.6], windowX: [0.6, 2.8], panes: [3, 2], width: 3.4, wall: [222, 218, 206], seed: 23, grooves: false });
  paintDoor(atlas);
  paintBrick(atlas);
  paintRoof(atlas);
  paintLawn(atlas);
  for (const [name, color] of Object.entries(SWATCH)) atlas.paint(regions[name], (x, y) => concrete(color, x, y, 60, 2, 0));
  await paintSign(atlas, ctx);
}

// ---- Geometry ------------------------------------------------------------------------
export function build(mesh, { W, D, H, entranceOffset, spec }) {
  const { fbox, rect, SIDES, isEnd, span } = mesh;
  const FASCIA = [5.0, 5.6]; // bottom band of the screen (underside = ceiling of the recess)
  const COPING = [H - 0.6, H]; // top band (parapet)
  const ROWS = 4;
  const ROW = (COPING[0] - FASCIA[1]) / ROWS;
  const RIB_W = 0.24, RIB_H = 0.22;
  const BAND_D = 0.35;
  const RIB_D = [0.01, 0.12]; // ribs 1 cm behind the bands: no coplanar faces where they cross
  const INFILL_D = [0.12, 0.22];
  const INNER_D = 1.3; // wall behind the screen; the slot between them is open to the sky
  const RECESS_D = 2.6; // ground-floor wall, set back under the screen
  const ROOF_Y = H - 0.8;
  const MODULE = 3.35; // panel column width
  const DOOR = { half: 1.6, top: 3.45, depth: 0.35 };
  const TERRACE_Y = 0.45;
  const GAP_HALF = 2.2;
  const signHalf = (spec.sign?.width || 7) / 2;
  const random = rng(99);

  for (const side of Object.keys(SIDES)) {
    const { S } = SIDES[side];
    const n = Math.max(3, Math.round(S / MODULE));
    const m = S / n;

    // Screen: bands, grid and perforated panels.
    fbox(side, span(side, BAND_D), COPING, [0, BAND_D], "otib", "white");
    fbox(side, span(side, BAND_D), FASCIA, [0, BAND_D], "ot", "white");
    for (let r = 1; r < ROWS; r += 1) {
      const y = FASCIA[1] + r * ROW;
      fbox(side, span(side, RIB_D[1]), [y - RIB_H / 2, y + RIB_H / 2], [0, RIB_D[1]], "otb", "white");
    }
    for (let k = 0; k <= n; k += 1) {
      const a = k * m;
      const faces = "o" + (k === 0 ? "" : "l") + (k === n ? "" : "r");
      fbox(side, [Math.max(0, a - RIB_W / 2), Math.min(S, a + RIB_W / 2)], [FASCIA[1], COPING[0]], [RIB_D[0], k === 0 || k === n ? INFILL_D[1] : RIB_D[1]], faces, "white");
    }
    for (let c = 0; c < n; c += 1) {
      for (let r = 0; r < ROWS; r += 1) {
        const y0 = FASCIA[1] + r * ROW + (r > 0 ? RIB_H / 2 : 0);
        const y1 = FASCIA[1] + (r + 1) * ROW - (r < ROWS - 1 ? RIB_H / 2 : 0);
        const weathering = (0.95 + random() * 0.05) * (r === ROWS - 1 ? 0.97 : 1);
        fbox(side, [c * m + RIB_W / 2, (c + 1) * m - RIB_W / 2], [y0, y1], INFILL_D, "o", "panel", weathering);
      }
    }
    fbox(side, span(side, INFILL_D[1]), [FASCIA[1], COPING[0]], INFILL_D, "i", "dark", 0.8);
    fbox(side, isEnd(side) ? [INNER_D, S - INNER_D] : [BAND_D, S - BAND_D], [FASCIA[1] - 0.2, FASCIA[1]], [BAND_D, INNER_D], "t", "dark", 0.7);
    fbox(side, [INNER_D, S - INNER_D], [FASCIA[1], ROOF_Y], [INNER_D, INNER_D + 0.2], "o", "dark", 0.75);
    fbox(side, span(side, RECESS_D), [FASCIA[0], FASCIA[0] + 0.1], [0, RECESS_D], "b", "soffit", 0.9);

    // Ground floor: window bays between pilasters, beams under the ceiling.
    const door = side === "front" ? [W / 2 + entranceOffset - DOOR.half, W / 2 + entranceOffset + DOOR.half] : null;
    const inDoor = (a0, a1, margin = 0) => door && a1 > door[0] - margin && a0 < door[1] + margin;
    const stops = [RECESS_D];
    for (let k = 1; k < n; k += 1) if (k * m > RECESS_D + 0.4 && k * m < S - RECESS_D - 0.4) stops.push(k * m);
    stops.push(S - RECESS_D);
    for (let i = 0; i < stops.length - 1; i += 1) {
      const [a0, a1] = [stops[i], stops[i + 1]];
      if (inDoor(a0, a1)) { // only the bay the door is in loses its window
        fbox(side, [a0, Math.max(a0, door[0])], [0, FASCIA[0]], [RECESS_D, RECESS_D + 0.1], "o", "cream", 0.85);
        fbox(side, [Math.min(a1, door[1]), a1], [0, FASCIA[0]], [RECESS_D, RECESS_D + 0.1], "o", "cream", 0.85);
      } else {
        fbox(side, [a0, a1], [0, FASCIA[0]], [RECESS_D, RECESS_D + 0.1], "o", Math.abs(a1 - a0 - m) < 0.05 ? "bay" : "cream", 0.85);
      }
    }
    const behindSign = (a) => side === "front" && Math.abs(a - (W / 2 + entranceOffset)) < signHalf + 0.2;
    for (let i = 1; i < stops.length - 1; i += 1) {
      const a = stops[i];
      if (inDoor(a - 0.22, a + 0.22, 0.25)) continue;
      fbox(side, [a - 0.22, a + 0.22], [0, FASCIA[0]], [RECESS_D - 0.3, RECESS_D], "olr", "white", 0.9);
      // Beams passing the signboard start behind it.
      fbox(side, [a - 0.15, a + 0.15], [FASCIA[0] - 0.45, FASCIA[0]], [behindSign(a) ? 0.12 : 0, RECESS_D - 0.3], "blro", "soffit", 0.9);
    }
    if (door) {
      fbox(side, door, [DOOR.top, FASCIA[0]], [RECESS_D, RECESS_D + 0.1], "o", "cream", 0.85);
      fbox(side, door, [TERRACE_Y, DOOR.top], [RECESS_D + DOOR.depth, RECESS_D + DOOR.depth + 0.1], "o", "door", 1);
      fbox(side, [door[0] - 0.2, door[0]], [TERRACE_Y, DOOR.top], [RECESS_D, RECESS_D + DOOR.depth], "r", "cream", 0.7);
      fbox(side, [door[1], door[1] + 0.2], [TERRACE_Y, DOOR.top], [RECESS_D, RECESS_D + DOOR.depth], "l", "cream", 0.7);
      fbox(side, door, [DOOR.top, DOOR.top + 0.1], [RECESS_D, RECESS_D + DOOR.depth], "b", "cream", 0.7);
      fbox(side, door, [TERRACE_Y - 0.1, TERRACE_Y], [RECESS_D, RECESS_D + DOOR.depth], "t", "stone", 0.9);
    }

    if (side === "front") {
      // Raised walkway, planter wall with piers and rails, steps and the signboard.
      const ae = W / 2 + entranceOffset;
      const gap = [ae - GAP_HALF, ae + GAP_HALF];
      fbox(side, [0.6, W - 0.6], [0, TERRACE_Y], [0.6, RECESS_D], "tlr", "stone", 0.95);
      for (const [p0, p1] of [[0.6, gap[0]], [gap[1], W - 0.6]]) {
        if (p1 - p0 < 0.5) continue;
        const count = Math.max(1, Math.round((p1 - p0) / 4));
        const step = (p1 - p0) / count;
        for (let k = 0; k < count; k += 1) {
          const s0 = p0 + k * step, s1 = s0 + step;
          const sub = [0, 0, Math.min(1, step / 5.6), 1];
          fbox(side, [s0, s1], [0, 0.72], [0.1, 0.6], "oi", "brick", 0.95, { o: sub, i: sub });
          fbox(side, [s0, s1], [0, 0.72], [0.1, 0.6], "t", "stone", 0.95);
          fbox(side, [s0, s1], [0.99, 1.04], [0.32, 0.38], "otb", "metal", 0.9);
          fbox(side, [s0, s1], [0.84, 0.88], [0.32, 0.38], "otb", "metal", 0.9);
        }
        fbox(side, [p0, p0 + 0.01], [0, 0.72], [0.1, 0.6], "l", "brick", 0.9);
        fbox(side, [p1 - 0.01, p1], [0, 0.72], [0.1, 0.6], "r", "brick", 0.9);
        for (let k = 0; k <= count; k += 1) {
          const a = Math.max(p0 + 0.22, Math.min(p1 - 0.22, p0 + k * step));
          fbox(side, [a - 0.22, a + 0.22], [0, 1.15], [0.13, 0.57], "oilrt", "pier", 0.95);
        }
      }
      fbox(side, gap, [0, 0.15], [0, 0.3], "otlr", "stone", 0.95);
      fbox(side, gap, [0.15, 0.3], [0.3, 0.6], "otlr", "stone", 0.95);
      fbox(side, gap, [0.3, TERRACE_Y], [0.6, 0.62], "o", "stone", 0.95);
      fbox(side, [ae - signHalf, ae + signHalf], [4.05, FASCIA[0]], [0.04, 0.1], "o", "sign", 1);
      fbox(side, [ae - signHalf, ae + signHalf], [4.05, FASCIA[0]], [0.04, 0.1], "lrb", "metal", 0.9);
    } else {
      fbox(side, span(side, RECESS_D), [0, 0.02], [0, RECESS_D], "t", "paving", 0.85);
    }
  }

  // Roof, and the courtyard (walls with windows, parapet rim, lawn) if there is one.
  const x0 = -W / 2 + INNER_D, x1 = W / 2 - INNER_D, z0 = -D / 2 + INNER_D, z1 = D / 2 - INNER_D;
  const court = spec.courtyard ? { cx: Math.min(spec.courtyard.width / 2, (x1 - x0) / 2 - 4), cz: Math.min(spec.courtyard.length / 2, (z1 - z0) / 2 - 4) } : null;
  const roofPiece = (a0, a1, b0, b1) => {
    const sub = [(a0 - x0) / (x1 - x0), (b0 - z0) / (z1 - z0), (a1 - x0) / (x1 - x0), (b1 - z0) / (z1 - z0)];
    rect([(a0 + a1) / 2, ROOF_Y, (b0 + b1) / 2], Y, [1, 0, 0], a1 - a0, b1 - b0, "roof", 1, [sub[0], 1 - sub[3], sub[2], 1 - sub[1]]);
  };
  if (!court) { roofPiece(x0, x1, z0, z1); return; }
  const { cx, cz } = court;
  roofPiece(x0, x1, cz, z1);
  roofPiece(x0, x1, z0, -cz);
  roofPiece(x0, -cx, -cz, cz);
  roofPiece(cx, x1, -cz, cz);
  const bands = [[0, FASCIA[0]], [FASCIA[0], (FASCIA[0] + ROOF_Y) / 2], [(FASCIA[0] + ROOF_Y) / 2, ROOF_Y]];
  const walls = [
    { from: [cx, -cz], to: [-cx, -cz], n: [0, 0, 1] },
    { from: [-cx, cz], to: [cx, cz], n: [0, 0, -1] },
    { from: [-cx, -cz], to: [-cx, cz], n: [1, 0, 0] },
    { from: [cx, cz], to: [cx, -cz], n: [-1, 0, 0] }
  ];
  for (const wall of walls) {
    const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    const count = Math.max(1, Math.round(length / 3.4));
    const right = cross(Y, wall.n);
    for (let k = 0; k < count; k += 1) {
      const t = (k + 0.5) / count;
      const x = wall.from[0] + (wall.to[0] - wall.from[0]) * t, z = wall.from[1] + (wall.to[1] - wall.from[1]) * t;
      bands.forEach(([b0, b1], i) => rect([x, (b0 + b1) / 2, z], wall.n, right, length / count, b1 - b0, "court", i === 0 ? 0.78 : 0.86));
    }
    const mid = [(wall.from[0] + wall.to[0]) / 2, (wall.from[1] + wall.to[1]) / 2];
    const back = [-wall.n[0], 0, -wall.n[2]];
    const extra = wall.n[0] ? 0 : 0.8;
    rect([mid[0], ROOF_Y + 0.3, mid[1]], wall.n, right, length + extra, 0.6, "white", 0.95);
    rect([mid[0] + back[0] * 0.4, ROOF_Y + 0.3, mid[1] + back[2] * 0.4], back, right.map((v) => -v), length + extra, 0.6, "white", 0.95);
    rect([mid[0] + back[0] * 0.2, ROOF_Y + 0.6, mid[1] + back[2] * 0.2], Y, right, length + extra, 0.4, "white", 1);
  }
  rect([0, 0.03, 0], Y, [1, 0, 0], cx * 2, cz * 2, "lawn", 0.85);
}
