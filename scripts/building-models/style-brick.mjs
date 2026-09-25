// "brick" style: the Institute of Bioequivalence Studies & Pharmaceutical Sciences
// (reference photos backup/models/source/ibsps/). Built along the footprint
// polygon's own edges. Terracotta brick-tile cladding with a thin white line at
// every floor; per wall one facade:
//   front    glass curtain wall between brick piers, a grey slab band at every
//            floor, the recessed glass entrance under a concrete canopy, steps and a
//            signboard on the lawn (the wall at the entrance)
//   bays     brick with deep recessed window bays: grey reveals, a grey ledge at
//            every floor, a hood at the top; wide plain brick panels at the ends
//   fins     deep brick fins with grey plaster and small windows between them
//   plaster  light grey plaster
//   plain    brick, with one window bay in the middle when long enough
// Defaults: the wall at the entrance is the front; then 14 m and longer: bays,
// 9-14 m: fins, shorter: plain. spec.facades overrides by wall number (the builder
// prints them with the direction they face). Extras:
//   spec.tower     { wall, side: "left" | "right" }  board-formed concrete stair
//                  tower at that end of the wall (seen from outside), rising above
//                  the roof under a flat hood
//   spec.balconies { wall, side }  stacked cantilevered concrete balconies
// A roof box with a thin projecting slab roof stands on the roof.
import { concrete, hash, mix, scale, valueNoise } from "./atlas.mjs";
import { interiorPoint, nearestEdge, polygonEdges, segmentDistance, worldBearing } from "./polygon.mjs";

// Tall regions span the whole height (ground to parapet top); their widths in metres:
const TALL = { brickTall: 3.0, slotTall: 1.85, concreteTall: 3.2, towerWinTall: 1.2, plasterTall: 2.0 };
export const regions = {
  brickTall: [0, 0, 192, 1024],
  bayWin: [192, 0, 256, 224],
  curtain: [448, 0, 384, 224],
  lobby: [832, 0, 192, 224],
  slotTall: [192, 224, 96, 800],
  concreteTall: [288, 224, 160, 800],
  towerWinTall: [448, 224, 96, 800],
  plasterTall: [544, 224, 128, 800],
  sign: [672, 224, 352, 128],
  roof: [672, 352, 256, 256],
  grey: [928, 352, 64, 64],
  greyLight: [928, 416, 64, 64],
  white: [928, 480, 64, 64],
  dark: [928, 544, 64, 64],
  brick: [672, 608, 64, 64],
  concrete: [736, 608, 64, 64],
  metal: [800, 608, 64, 64],
  glass: [864, 608, 64, 64],
  paving: [928, 608, 64, 64]
};
const SWATCH = { grey: [168, 170, 170], greyLight: [206, 208, 210], white: [238, 236, 230], dark: [52, 56, 60], brick: [196, 110, 72], concrete: [182, 182, 176], metal: [96, 100, 104], glass: [150, 176, 184], paving: [196, 192, 184] };
export const swatches = Object.keys(SWATCH);

// Storeys: ground floor, upper floors of equal height up to the roof, parapet.
export function layout(H, spec = {}) {
  const GROUND = spec.groundHeight ?? 3.8, PARAPET = 1.0;
  const roofY = H - PARAPET;
  const floors = Math.max(1, Math.round((roofY - GROUND) / (spec.floorHeight ?? 3.0)));
  const f = (roofY - GROUND) / floors;
  const levels = [0, ...Array.from({ length: floors + 1 }, (_, i) => GROUND + i * f)]; // floor lines, roof last
  return { GROUND, PARAPET, roofY, floors, f, levels };
}

// ---- Texture -------------------------------------------------------------------------
// y in metres of a pixel row of a tall region.
const rowMetres = (py, h, H) => H * (1 - (py + 0.5) / h);
const nearLine = (y, levels, width) => levels.some((level) => Math.abs(y - level) < width);

function paintBrick(atlas, { H, levels }) {
  const [, , w, h] = regions.brickTall;
  const pxPerM = w / TALL.brickTall;
  atlas.paint(regions.brickTall, (x, py) => {
    const y = rowMetres(py, h, H);
    const course = Math.floor(y / 0.1), mx = x / pxPerM + (course % 2) * 0.15;
    const tile = Math.floor(mx / 0.3);
    let c = mix([198, 106, 66], [218, 128, 86], hash(tile, course, 7));
    c = scale(c, 1 + (valueNoise(x, py, 30, 8) - 0.5) * 0.08);
    if ((y % 0.1) < 0.012 || (mx % 0.3) < 0.02) c = mix(c, [222, 190, 164], 0.55); // mortar
    if (nearLine(y, levels.slice(1), 0.035)) c = [240, 238, 232]; // white floor line
    if (y < 0.3) c = concrete([176, 170, 162], x, py, 9, 3, 4); // plinth
    return c;
  });
}

// Window of a bay (3.4 m x one floor): grey frame, two windows with white grilles
// behind dark glass, a transom row, a grey sill band at the bottom.
function paintBayWindow(atlas) {
  const [, , w, h] = regions.bayWin;
  atlas.paint(regions.bayWin, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete([164, 166, 166], x, y, 21, 3, 4);
    if (u > 0.06 && u < 0.94 && v > 0.14 && v < 0.9) {
      c = mix([56, 64, 70], [92, 104, 110], (v - 0.14) / 0.76);
      const gu = (u * 12) % 1, gv = (v * 7) % 1;
      if (gu < 0.07 || gv < 0.08 || (gu > 0.45 && gu < 0.52 && gv < 0.55)) c = [226, 228, 226]; // grille
      if (Math.abs(u - 0.56) < 0.035 || Math.abs(v - 0.7) < 0.03) c = [176, 178, 178]; // mullion, transom
    }
    return c;
  });
}

// Glass curtain wall (5 m x one floor): slab band, grey frames, reflective glass,
// white decorative grille.
function paintCurtain(atlas) {
  const [, , w, h] = regions.curtain;
  atlas.paint(regions.curtain, (x, y) => {
    const u = x / w, v = 1 - y / h;
    if (v < 0.09) return concrete([176, 178, 178], x, y, 31, 2, 3);
    let c = mix([112, 132, 140], [168, 186, 192], (v - 0.09) / 0.91 * 0.6 + valueNoise(x, y, 60, 32) * 0.4);
    const pu = (u * 4) % 1, pv = ((v - 0.09) / 0.91 * 3) % 1;
    if ((Math.floor(u * 4) + Math.floor((v - 0.09) / 0.91 * 3)) % 3 === 0 && ((pu * 5) % 1 < 0.1 || (pv * 4) % 1 < 0.12)) c = [232, 234, 232]; // grille
    if (pu < 0.025 || pu > 0.975 || Math.abs(v - 0.66) < 0.018) c = [150, 152, 154]; // frames
    return c;
  });
}

function paintLobby(atlas) {
  const [, , w, h] = regions.lobby;
  atlas.paint(regions.lobby, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = mix([30, 34, 38], [58, 66, 72], v);
    if (Math.abs((u * 4) % 1 - 0.5) > 0.46 || Math.abs(v - 0.78) < 0.012) c = [120, 124, 128];
    if (Math.abs(v - 0.9) < 0.02 && Math.abs((u * 3) % 1 - 0.5) < 0.12) c = [220, 206, 168]; // lights inside
    return c;
  });
}

// Grey plaster between fins: a small window on every floor.
function paintSlot(atlas, { H, levels, GROUND, f }) {
  const [, , w, h] = regions.slotTall;
  atlas.paint(regions.slotTall, (x, py) => {
    const u = x / w, y = rowMetres(py, h, H);
    let c = concrete([196, 198, 198], x, py, 41, 3, 5);
    const floor = y < GROUND ? -1 : Math.floor((y - GROUND) / f);
    const fy = y < GROUND ? y / GROUND : (y - GROUND - floor * f) / f;
    if (y < levels.at(-1) && u > 0.3 && u < 0.7 && fy > 0.3 && fy < 0.78) c = fy > 0.74 || u < 0.33 || u > 0.67 ? [150, 152, 152] : mix([52, 58, 62], [84, 92, 96], fy);
    if (nearLine(y, levels.slice(1), 0.03)) c = [150, 152, 152];
    return c;
  });
}

// Board-formed concrete (stair tower), and its side with a window on every floor.
function paintConcrete(atlas, region, width, { H, GROUND, f }, windows) {
  const [, , w, h] = region;
  atlas.paint(region, (x, py) => {
    const u = x / w, y = rowMetres(py, h, H), mx = u * width;
    let c = concrete([184, 184, 178], x, py, windows ? 51 : 53, 4, 10);
    c = mix(c, [150, 150, 144], Math.max(0, valueNoise(x, 0, 11, 54) - 0.6) * 0.8 * (0.4 + 0.6 * py / h)); // streaks
    if ((mx % 1.1) < 0.02 || (y % 0.8) < 0.02) c = scale(c, 0.9); // panel joints
    if (windows && y > GROUND * 0.6 && y < H - 1.2) {
      const fy = ((y - GROUND * 0.6) % f) / f;
      if (u > 0.14 && u < 0.86 && fy > 0.1 && fy < 0.86) {
        c = mix([58, 64, 68], [86, 94, 98], fy);
        if ((u * 11) % 1 < 0.16 || (fy * 9) % 1 < 0.16) c = [206, 208, 206]; // grille
      }
    }
    return c;
  });
}

function paintPlaster(atlas, { H, levels }) {
  const [, , w, h] = regions.plasterTall;
  atlas.paint(regions.plasterTall, (x, py) => {
    const y = rowMetres(py, h, H);
    let c = concrete([212, 214, 216], x, py, 61, 2, 4);
    if (nearLine(y, levels.slice(1), 0.02)) c = [194, 196, 198];
    return c;
  });
  void w;
}

// Lawn signboard: light board, emblem, the building's names.
async function paintSign(atlas, feature) {
  const [x0, y0, w, h] = regions.sign;
  atlas.paint(regions.sign, (x, y) => {
    if (x < 5 || y < 5 || x >= w - 5 || y >= h - 5) return [72, 88, 110];
    const d = Math.hypot(x - w / 2, y - h * 0.2);
    if (d < h * 0.12) return d > h * 0.1 ? [72, 88, 110] : [214, 222, 230];
    return concrete([200, 210, 220], x, y, 71, 2, 3);
  });
  const p = feature.properties;
  await atlas.text(regions.sign, [
    ...(p.name_bn ? [{ text: p.name_bn, height: 0.2, top: 0.36, color: "#1f2f45", bold: true }] : []),
    { text: p.name_en || "", height: 0.15, top: 0.6, color: "#1f2f45", bold: true, font: "Arial" },
    { text: "Bangladesh Council of Scientific and Industrial Research", height: 0.11, top: 0.8, color: "#1f2f45", font: "Arial" }
  ]);
  void x0; void y0;
}

export async function paint(atlas, { H, spec, feature }) {
  const L = layout(H, spec);
  const ctx = { H, ...L };
  paintBrick(atlas, ctx);
  paintBayWindow(atlas);
  paintCurtain(atlas);
  paintLobby(atlas);
  paintSlot(atlas, ctx);
  paintConcrete(atlas, regions.concreteTall, TALL.concreteTall, ctx, false);
  paintConcrete(atlas, regions.towerWinTall, TALL.towerWinTall, ctx, true);
  paintPlaster(atlas, ctx);
  atlas.paint(regions.roof, (x, y) => concrete([176, 174, 168], x, y, 81, 5, 10));
  for (const [name, color] of Object.entries(SWATCH)) atlas.paint(regions[name], (x, y) => concrete(color, x, y, 60, 2, 0));
  await paintSign(atlas, feature);
}

// ---- Geometry ------------------------------------------------------------------------
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function build(mesh, { H, W, D, spec, polygon, neighbours = [], entrance = null, entranceCoords = null, rotation = 0 }) {
  const { fbox, box, polygon: roofPolygon } = mesh;
  const { pts, edges } = polygonEdges(polygon, { neighbours });
  const { GROUND, roofY, floors, f, levels } = layout(H, spec);
  const floorBands = [[0, GROUND], ...Array.from({ length: floors }, (_, i) => [GROUND + i * f, GROUND + (i + 1) * f])];

  // Front: the longest outer wall within 8 m of the entrance (else the nearest one).
  const point = entrance || entranceCoords;
  let front = null;
  if (point) {
    const near = edges.filter((edge) => edge.kind === "outer" && segmentDistance(point, edge.A, edge.B) < 8).sort((a, b) => b.L - a.L)[0];
    front = near ? nearestEdge(point, [near]) : nearestEdge(point, edges);
  }
  const start = front ? edges.indexOf(front.edge) : 0;
  const order = edges.map((_, i) => edges[(start + i) % edges.length]);
  // Convexity of each wall's two ends (a = 0 is at B, the left end seen from outside).
  order.forEach((edge) => { const i = edges.indexOf(edge); edge.convexRight = edges[(i - 1 + edges.length) % edges.length].convexEnd; });
  const types = order.map((edge, i) => {
    if (edge.kind === "shared") return "shared";
    if (spec.facades?.[i]) return spec.facades[i];
    if (edge === front?.edge) return "front";
    return edge.L >= 14 ? "bays" : edge.L >= 9 ? "fins" : "plain";
  });

  // Brick, plaster or concrete cells with the same texel size everywhere.
  const tall = (fr, region, a0, a1, y0, y1, d = 0, face = "o", ao = 1) => {
    const width = TALL[region], n = Math.max(1, Math.ceil((a1 - a0) / width - 1e-6));
    for (let k = 0; k < n; k += 1) {
      const c0 = a0 + ((a1 - a0) * k) / n, c1 = a0 + ((a1 - a0) * (k + 1)) / n;
      fbox(fr, [c0, c1], [y0, y1], [d, d + 0.1], face, region, ao, { [face]: [0, y0 / H, Math.min(1, (c1 - c0) / width), y1 / H] });
    }
  };
  const brick = (fr, a0, a1, y0 = 0, y1 = H, d = 0) => tall(fr, "brickTall", a0, a1, y0, y1, d);

  // A recessed window bay [b0, b1] of full height (R deep).
  const bay = (fr, b0, b1, R = 0.9) => {
    for (const [y0, y1] of floorBands) fbox(fr, [b0, b1], [y0, y1], [R, R + 0.1], "o", "bayWin", 0.82);
    fbox(fr, [b0 - 0.01, b0], [0, roofY], [0, R], "r", "grey", 0.85);
    fbox(fr, [b1, b1 + 0.01], [0, roofY], [0, R], "l", "grey", 0.85);
    for (const y of levels.slice(1, -1)) fbox(fr, [b0, b1], [y - 0.16, y], [-0.2, R], "otb", "grey", 1);
    fbox(fr, [b0, b1], [roofY - 0.45, roofY], [-0.35, R], "otb", "grey", 0.95);
    brick(fr, b0, b1, roofY, H);
  };

  // Bays along [a0, a1]: brick end panels and piers between recessed bays.
  const bays = (fr, a0, a1) => {
    const L = a1 - a0, PIER = 1.4, BAY = 3.4;
    const count = Math.max(1, Math.floor((L - 3.2 + PIER) / (BAY + PIER)));
    const span = count * BAY + (count - 1) * PIER;
    if (L < BAY + 1.6) { brick(fr, a0, a1); return; }
    let a = a0 + (L - span) / 2;
    brick(fr, a0, a);
    for (let k = 0; k < count; k += 1) {
      bay(fr, a, a + BAY);
      a += BAY;
      if (k < count - 1) { brick(fr, a, a + PIER); a += PIER; }
    }
    brick(fr, a, a1);
  };

  const walls = [];
  order.forEach((edge, index) => {
    const type = types[index];
    const { frame: fr, L } = edge;
    walls.push(`${index}:${type} ${L.toFixed(1)} m facing ${COMPASS[Math.round(worldBearing(edge.n, rotation) / 45) % 8]}`);
    if (type === "shared" || L < 0.5) return;
    // Extras at a wall end take their width off the facade.
    const extra = (item) => (item && item.wall === index ? (item.side === "left" ? [0, 3.2] : [L - 3.2, L]) : null);
    const tower = extra(spec.tower), balcony = extra(spec.balconies);
    let a0 = 0, a1 = L;
    if (tower) { if (tower[0] === 0) a0 = tower[1]; else a1 = tower[0]; }

    if (type === "front") {
      // Brick piers, curtain wall with slab bands, entrance, canopy, steps, signboard.
      const PIER = 1.2, D0 = 0.15;
      const spans = Math.max(1, Math.round((a1 - a0 - PIER) / 5.4));
      const glassW = (a1 - a0 - (spans + 1) * PIER) / spans;
      const door = front?.edge === edge ? Math.max(a0, Math.min(a1, front.a)) : (a0 + a1) / 2;
      for (let k = 0; k <= spans; k += 1) {
        const p0 = a0 + k * (PIER + glassW);
        fbox(fr, [p0, p0 + PIER], [0, H], [-0.45, 0], "o", "brickTall", 1, { o: [0, 0, PIER / TALL.brickTall, 1] });
        fbox(fr, [p0, p0 + PIER], [0, H], [-0.45, 0], "lr", "brickTall", 0.9, { l: [0, 0, 0.15, 1], r: [0, 0, 0.15, 1] });
        fbox(fr, [p0, p0 + PIER], [H - 0.01, H], [-0.45, 0], "t", "white", 1);
      }
      for (let k = 0; k < spans; k += 1) {
        const s0 = a0 + PIER + k * (PIER + glassW), s1 = s0 + glassW;
        const entranceSpan = door >= s0 - PIER / 2 && door < s1 + PIER / 2;
        for (const [y0, y1] of floorBands.slice(1)) fbox(fr, [s0, s1], [y0, y1], [D0, D0 + 0.1], "o", "curtain", 0.95);
        for (const y of levels.slice(2, -1)) fbox(fr, [s0, s1], [y - 0.22, y], [-0.12, D0], "otb", "grey", 1);
        brick(fr, s0, s1, roofY, H);
        if (!entranceSpan) { fbox(fr, [s0, s1], [0, GROUND], [D0, D0 + 0.1], "o", "curtain", 0.9); continue; }
        // Entrance: recessed glass lobby, reveals, ceiling, the canopy slab over it, steps.
        const R = 2.2;
        fbox(fr, [s0, s1], [0, GROUND - 0.4], [R, R + 0.1], "o", "lobby", 0.95);
        fbox(fr, [s0, s1], [GROUND - 0.4, GROUND], [0, R], "ob", "greyLight", 0.8);
        fbox(fr, [s0 - 0.01, s0], [0, GROUND], [0, R], "r", "greyLight", 0.8);
        fbox(fr, [s1, s1 + 0.01], [0, GROUND], [0, R], "l", "greyLight", 0.8);
        fbox(fr, [s0 - 0.4, s1 + 0.4], [GROUND, GROUND + 0.35], [-2.8, 0], "otblr", "greyLight", 1);
        for (let s = 0; s < 3; s += 1) fbox(fr, [s0 + 0.2, s1 - 0.2], [0.15 * s, 0.15 * (s + 1)], [-1.2 + 0.4 * s, R], "otlr", "paving", 0.95);
        fbox(fr, [s0, s1], [0.45, 0.46], [0, R], "t", "paving", 0.9);
        // Signboard on two posts on the lawn in front, to the right of the entrance.
        const sa = Math.min(L + 2, s1 + 3.5);
        fbox(fr, [sa, sa + 2.6], [1.0, 2.5], [-7.05, -7.0], "o", "sign", 1);
        fbox(fr, [sa, sa + 2.6], [1.0, 2.5], [-7.05, -7.0], "i", "metal", 0.8);
        for (const pa of [sa + 0.15, sa + 2.35]) fbox(fr, [pa - 0.05, pa + 0.05], [0, 2.5], [-6.98, -6.88], "olri", "metal", 1);
      }
    } else if (type === "fins") {
      // Brick fins projecting 0.9 m, grey plaster with small windows between them.
      const P = 0.9, FIN = 0.55;
      const n = Math.max(2, Math.round((a1 - a0) / 2.4) + 1);
      const at = (k) => a0 + FIN / 2 + ((a1 - a0 - FIN) * k) / (n - 1);
      for (let k = 0; k < n; k += 1) {
        const c = at(k);
        fbox(fr, [c - FIN / 2, c + FIN / 2], [0, H], [-P, 0], "o", "brickTall", 1, { o: [0, 0, FIN / TALL.brickTall, 1] });
        fbox(fr, [c - FIN / 2, c + FIN / 2], [0, H], [-P, 0], "lr", "brickTall", 0.88, { l: [0, 0, P / TALL.brickTall, 1], r: [0, 0, P / TALL.brickTall, 1] });
        fbox(fr, [c - FIN / 2, c + FIN / 2], [H - 0.01, H], [-P, 0], "t", "white", 1);
        if (k < n - 1) {
          const g0 = c + FIN / 2, g1 = at(k + 1) - FIN / 2;
          tall(fr, "slotTall", g0, g1, 0, roofY, 0, "o", 0.85);
          brick(fr, g0, g1, roofY, H);
        }
      }
      if (at(0) - FIN / 2 > a0 + 0.01) brick(fr, a0, at(0) - FIN / 2);
      if (at(n - 1) + FIN / 2 < a1 - 0.01) brick(fr, at(n - 1) + FIN / 2, a1);
    } else if (type === "plaster") {
      tall(fr, "plasterTall", a0, a1, 0, H, 0, "o", 0.95);
    } else if (type === "plain") {
      if (a1 - a0 >= 6) { const m = (a0 + a1) / 2; brick(fr, a0, m - 1.7); bay(fr, m - 1.7, m + 1.7); brick(fr, m + 1.7, a1); }
      else brick(fr, a0, a1);
    } else {
      bays(fr, a0, a1);
    }

    if (tower) {
      // Board-formed concrete stair tower, 1.2 m proud, windows on its side facing
      // along the facade, rising 2.4 m above the roof to a flat hood.
      const [t0, t1] = tower, P = 1.2, rise = H + 2.4;
      const inner = tower[0] === 0 ? "r" : "l"; // the side towards the facade
      const corner = inner === "r" ? "l" : "r";
      const cornerConvex = corner === "l" ? edge.convexEnd : edge.convexRight;
      fbox(fr, [t0, t1], [0, H], [-P, 0], "o", "concreteTall", 1, { o: [0, 0, 1, 1] });
      fbox(fr, [t0, t1], [0, H], [-P, 0], inner, "towerWinTall", 0.9, { [inner]: [0, 0, 1, 1] });
      if (cornerConvex) fbox(fr, [t0, t1], [0, H], [-P, 0], corner, "concreteTall", 0.9, { [corner]: [0, 0, P / TALL.concreteTall, 1] });
      for (const pa of [t0, t1 - 0.3]) fbox(fr, [pa, pa + 0.3], [H, rise], [-P, -P + 0.3], "olri", "concrete", 1);
      fbox(fr, [t0 + 0.3, t1 - 0.3], [H, rise], [0.6, 0.7], "o", "dark", 0.7);
      fbox(fr, [t0 - 0.3, t1 + 0.3], [rise, rise + 0.3], [-P - 0.6, 2.5], "otblr", "concrete", 1);
      fbox(fr, [t0, t1], [H - 0.01, H], [-P, 0.6], "t", "concrete", 0.9);
    }

    if (balcony) {
      // Glazing strip on the wall and a concrete box on every other floor.
      const [b0, b1] = balcony;
      for (const [y0, y1] of floorBands.slice(1)) fbox(fr, [b0 + 0.2, b1 - 0.2], [y0, y1], [-0.04, 0.06], "o", "bayWin", 0.9);
      for (let i = 1; i < floors; i += 2) {
        const y = GROUND + i * f;
        fbox(fr, [b0, b1], [y - 0.25, y + 1.0], [-1.5, -0.04], "otblr", "concrete", 1);
        fbox(fr, [b0 + 0.1, b1 - 0.1], [y + 1.0, y + 1.1], [-1.45, -1.4], "o", "glass", 1);
      }
    }

    // Parapet: white coping and the inside face.
    fbox(fr, [0, L], [roofY, H], [0, 0.25], "ti", "white", 0.95);
  });

  // Roof, and the roof box with a thin slab roof projecting all round.
  roofPolygon(pts, roofY, "roof", 1, (x, z) => [(x + W / 2) / W, 1 - (z + D / 2) / D]);
  const spot = interiorPoint(pts, edges);
  if (spot && spot.clearance > 3.5) {
    const { x, z } = spot;
    box([x - 3, x + 3], [roofY, roofY + 3.2], [z - 2.2, z + 2.2], "+z -z +x -x", "greyLight", 0.95);
    box([x - 3.6, x + 3.6], [roofY + 3.2, roofY + 3.45], [z - 2.8, z + 2.8], "+z -z +x -x +y -y", "white", 1);
  }
  return { facades: walls };
}
