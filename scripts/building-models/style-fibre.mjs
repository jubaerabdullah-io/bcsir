// "fibre" style: the Fibre & Polymer Research Division (reference photos
// backup/models/source/fibre/). Built along the footprint polygon's own edges; per
// wall one facade:
//   entrance  the entrance wing's face: orange-red panels and the glass door on the
//             ground floor under a flat canopy (dark fascia) with a steel railing and
//             red potted plants on it; green glass in a white frame above
//   front     the main face beside the wing: the tall green glass curtain wall in a
//             white aluminium frame rising above the roof, then cream plaster
//   plaster   cream plaster, grey pilasters between the window bays
//   panel     white aluminium panels with a dark window band on every floor
// Defaults: the wall at the entrance is `entrance`, the others `plaster`;
// spec.facades overrides by wall number (the builder prints them). In front of the
// `front` wall, the garden of the photos: the blue fountain pool with the small wooden
// bridge and red railings, the stone feature wall in a white frame, lamp posts.
import { concrete, hash, mix, scale, valueNoise } from "./atlas.mjs";
import { interiorPoint, nearestEdge, polygonEdges, segmentDistance, worldBearing } from "./polygon.mjs";

export const regions = {
  plasterBay: [0, 0, 256, 256],
  panelBay: [256, 0, 256, 256],
  greenGlass: [512, 0, 256, 256],
  orange: [768, 0, 256, 256],
  door: [0, 272, 192, 256],
  railing: [208, 272, 256, 64],
  water: [208, 352, 128, 128],
  poolTile: [352, 352, 64, 64],
  stone: [480, 272, 128, 128],
  plaster: [624, 272, 128, 128],
  roof: [768, 272, 256, 256],
  white: [480, 432, 48, 48],
  grey: [544, 432, 48, 48],
  dark: [608, 432, 48, 48],
  soffit: [672, 432, 48, 48],
  wood: [480, 496, 48, 48],
  red: [544, 496, 48, 48],
  pot: [608, 496, 48, 48],
  leaf: [672, 496, 48, 48],
  lamp: [352, 432, 48, 48],
  globe: [416, 432, 48, 48]
};
const CREAM = [230, 218, 186];
const SWATCH = { white: [234, 236, 238], grey: [150, 152, 156], dark: [56, 62, 68], soffit: [236, 236, 232], wood: [140, 92, 52], red: [196, 40, 36], pot: [186, 72, 52], leaf: [64, 124, 52], lamp: [40, 40, 42], globe: [246, 246, 240] };
export const swatches = Object.keys(SWATCH);
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const BAY = 3.6, PIECE = 2.4;

// ---- Texture -------------------------------------------------------------------------
function greenGlass(x, y, w, h) {
  const u = x / w, v = 1 - y / h;
  if (u < 0.02 || Math.abs(u - 0.5) < 0.01 || v < 0.03 || Math.abs(v - 0.62) < 0.012) return [70, 80, 76]; // mullions
  let c = mix([20, 110, 40], [110, 200, 110], v * 0.55 + valueNoise(x, y, 40, 5) * 0.25);
  if (Math.abs(u - v * 0.5 - 0.3) < 0.07) c = mix(c, [170, 230, 170], 0.35); // reflection
  return c;
}

export async function paint(atlas) {
  atlas.paint(regions.plasterBay, (x, y, w, h) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete(CREAM, x, y, 11, 3, 7);
    if (u > 0.24 && u < 0.76 && v > 0.3 && v < 0.78) {
      const fu = (u - 0.24) / 0.52, fv = (v - 0.3) / 0.48;
      c = fu < 0.05 || fu > 0.95 || fv < 0.05 || fv > 0.95 || Math.abs(fu - 0.5) < 0.02 ? [120, 124, 128] : mix([34, 40, 44], [90, 100, 104], fv * 0.6 + valueNoise(x, y, 18, 12) * 0.2);
    }
    if (u > 0.22 && u < 0.78 && v > 0.27 && v <= 0.3) c = [214, 206, 180];
    return c;
  });
  atlas.paint(regions.panelBay, (x, y, w, h) => {
    const v = 1 - y / h;
    if (v > 0.34 && v < 0.72) return (x % 64 < 2 || Math.abs(v - 0.53) < 0.006) ? [60, 64, 70] : mix([30, 40, 46], [100, 112, 118], (v - 0.34) / 0.38 * 0.6 + valueNoise(x, y, 20, 13) * 0.2);
    if (x % 64 < 2 || y % 43 < 2) return [196, 198, 202]; // panel joints
    return scale([228, 230, 234], 0.97 + hash(Math.floor(x / 64), Math.floor(y / 43), 14) * 0.05);
  });
  atlas.paint(regions.greenGlass, greenGlass);
  atlas.paint(regions.orange, (x, y) => (x % 64 < 2 || y % 64 < 2 ? [150, 60, 30] : scale([226, 92, 38], 0.95 + hash(Math.floor(x / 64), Math.floor(y / 64), 15) * 0.08)));
  // Glass double door in an orange frame, the lobby lit behind.
  atlas.paint(regions.door, (x, y, w, h) => {
    const u = x / w, v = 1 - y / h;
    if (u < 0.06 || u > 0.94 || v > 0.94 || Math.abs(u - 0.5) < 0.015) return [200, 80, 34];
    return mix([70, 60, 50], [210, 196, 170], v * 0.5 + 0.2);
  });
  // Steel railing: posts every 64 px (1 m), top rail, three bars; transparent between.
  atlas.paint(regions.railing, (x, y, w, h) => {
    const v = 1 - y / h;
    const metal = x % 64 < 4 || v > 0.9 || Math.abs(v - 0.3) < 0.03 || Math.abs(v - 0.55) < 0.03 || Math.abs(v - 0.1) < 0.03;
    return metal ? [150, 156, 160, 255] : [150, 156, 160, 0];
  });
  atlas.paint(regions.water, (x, y) => scale(mix([40, 140, 220], [120, 200, 240], valueNoise(x, y, 16, 21)), 0.96 + hash(x, y, 22) * 0.06));
  atlas.paint(regions.poolTile, (x, y) => (x % 16 < 1 || y % 16 < 1 ? [226, 232, 236] : [36, 118, 208]));
  atlas.paint(regions.stone, (x, y) => {
    const row = Math.floor(y / 14), col = Math.floor((x + (row % 2) * 11) / 22);
    if (y % 14 < 2 || (x + (row % 2) * 11) % 22 < 2) return [70, 60, 52];
    return scale(mix([120, 84, 62], [178, 150, 120], hash(col, row, 31)), 0.92 + hash(x, y, 32) * 0.12);
  });
  atlas.paint(regions.plaster, (x, y) => concrete(CREAM, x, y, 41, 3, 7));
  atlas.paint(regions.roof, (x, y) => concrete([160, 158, 150], x, y, 51, 5, 12));
  for (const [name, color] of Object.entries(SWATCH)) {
    const [x0, y0, w, h] = regions[name];
    atlas.paint([x0 - 8, y0 - 8, w + 16, h + 16], (x, y) => scale(color, 1 + (hash(x, y, 60) - 0.5) * 0.04));
  }
}

// ---- Geometry ------------------------------------------------------------------------
export function build(mesh, { H, W, D, spec, polygon, neighbours = [], entrance = null, entranceCoords = null, rotation = 0 }) {
  const { fbox, box, polygon: roofPolygon } = mesh;
  const { pts, edges } = polygonEdges(polygon, { neighbours });
  const GROUND = 3.8, PARAPET = 1.0, roofY = H - PARAPET;
  const floors = Math.max(1, Math.round((roofY - GROUND) / 3.5));
  const f = (roofY - GROUND) / floors;
  const levels = [0, ...Array.from({ length: floors }, (_, i) => GROUND + i * f), roofY];

  // Entrance wall: the longest outer wall within 8 m of the entrance.
  const point = entrance || entranceCoords;
  let front = null;
  if (point) {
    const near = edges.filter((edge) => edge.kind === "outer" && segmentDistance(point, edge.A, edge.B) < 8).sort((a, b) => b.L - a.L)[0];
    front = near ? nearestEdge(point, [near]) : nearestEdge(point, edges);
  }
  const start = front ? edges.indexOf(front.edge) : 0;
  const order = edges.map((_, i) => edges[(start + i) % edges.length]);
  const types = order.map((edge, i) => (edge.kind === "shared" ? "shared" : spec.facades?.[i] ?? (edge === front?.edge ? "entrance" : "plaster")));

  // Cells along [a0, a1] of a wall, one texture repeat each, on every floor.
  const cells = (fr, a0, a1, width, region, d = 0, y0 = 0, y1 = roofY) => {
    if (a1 - a0 < 0.2) return;
    const n = Math.max(1, Math.round((a1 - a0) / width)), m = (a1 - a0) / n;
    for (let k = 0; k < n; k += 1) for (let i = 0; i + 1 < levels.length; i += 1) {
      const [l0, l1] = [Math.max(levels[i], y0), Math.min(levels[i + 1], y1)];
      if (l1 - l0 > 0.05) fbox(fr, [a0 + k * m, a0 + (k + 1) * m], [l0, l1], [d, d + 0.1], "o", region, 0.95, { o: [0, (l0 - levels[i]) / (levels[i + 1] - levels[i]), 1, (l1 - levels[i]) / (levels[i + 1] - levels[i])] });
    }
  };
  const plaster = (fr, a0, a1) => {
    cells(fr, a0, a1, BAY, "plasterBay");
    const n = Math.max(1, Math.round((a1 - a0) / BAY));
    for (let k = 1; k < n; k += 1) {
      const a = a0 + ((a1 - a0) * k) / n;
      fbox(fr, [a - 0.22, a + 0.22], [0, roofY], [-0.25, 0], "olr", "grey", 1);
    }
  };
  // The tall green glass curtain wall in its white frame, rising above the roof.
  const glassTower = (fr, a0, a1) => {
    const crown = H + 1.5;
    cells(fr, a0 + 0.9, a1 - 0.9, PIECE, "greenGlass", 0.2, 0, H);
    for (const [s0, s1] of [[a0, a0 + 0.9], [a1 - 0.9, a1]]) fbox(fr, [s0, s1], [0, crown], [-0.3, 0.2], "olr", "white", 1);
    fbox(fr, [a0 + 0.9, a1 - 0.9], [H, crown], [-0.3, 0.2], "ob", "white", 1);
    fbox(fr, [a0, a1], [crown - 0.01, crown], [-0.3, 3], "t", "white", 1);
    fbox(fr, [a0, a1], [H, crown], [-0.3, 3], "i", "white", 0.9);
    fbox(fr, [a0, a1], [H, crown], [0.2, 3], "lr", "white", 0.9);
  };

  // The garden in front of the main face: fountain pool, bridge, stone wall, lamps.
  const garden = (fr, L) => {
    const c = Math.min(L - 5, 7 + (L - 7) * 0.4), [p0, p1] = [c - 4, c + 4], [q0, q1] = [-6.5, -3];
    fbox(fr, [p0, p1], [0, 0.35], [q0, q0 + 0.3], "otbi", "poolTile", 1);
    fbox(fr, [p0, p1], [0, 0.35], [q1 - 0.3, q1], "otbi", "poolTile", 1);
    fbox(fr, [p0, p0 + 0.3], [0, 0.35], [q0 + 0.3, q1 - 0.3], "lrt", "poolTile", 1);
    fbox(fr, [p1 - 0.3, p1], [0, 0.35], [q0 + 0.3, q1 - 0.3], "lrt", "poolTile", 1);
    fbox(fr, [p0 + 0.3, p1 - 0.3], [0.2, 0.25], [q0 + 0.3, q1 - 0.3], "t", "water", 1);
    // Wooden bridge across the pool with red railings.
    fbox(fr, [c - 0.6, c + 0.6], [0.4, 0.5], [q0 - 0.5, q1 + 0.5], "otblr", "wood", 1);
    for (const a of [c - 0.6, c + 0.55]) {
      fbox(fr, [a, a + 0.05], [1.35, 1.42], [q0 - 0.5, q1 + 0.5], "otblr", "red", 1);
      for (let k = 0; k <= 4; k += 1) { const d = q0 - 0.5 + ((q1 - q0 + 1) * k) / 4; fbox(fr, [a, a + 0.05], [0.5, 1.35], [d - 0.03, d + 0.03], "olri", "red", 1); }
    }
    // Stone feature wall in a white frame, behind the pool's right end.
    fbox(fr, [p1 + 0.6, p1 + 2.8], [0, 1.8], [q1 + 0.4, q1 + 0.7], "o", "stone", 1);
    fbox(fr, [p1 + 0.5, p1 + 2.9], [0, 1.9], [q1 + 0.4, q1 + 0.7], "lrti", "white", 1);
    // Lamp posts with white globes.
    for (const [a, d] of [[p0 - 1, q0 - 1], [p1 + 1, q0 - 1], [p0 - 1, q1 + 0.2], [c, q0 - 1.5]]) {
      fbox(fr, [a - 0.04, a + 0.04], [0, 1.1], [d - 0.04, d + 0.04], "olri", "lamp", 1);
      fbox(fr, [a - 0.13, a + 0.13], [1.1, 1.36], [d - 0.13, d + 0.13], "olrit", "globe", 1);
    }
  };

  const walls = [];
  order.forEach((edge, index) => {
    const type = types[index];
    const { frame: fr, L } = edge;
    walls.push(`${index}:${type} ${L.toFixed(1)} m facing ${COMPASS[Math.round(worldBearing(edge.n, rotation) / 45) % 8]}`);
    if (type === "shared" || L < 0.3) return;
    if (type === "entrance") {
      const door = front?.edge === edge ? Math.max(1.3, Math.min(L - 1.3, front.a)) : L / 2;
      // Ground floor: orange panels, the door; canopy with railing and potted plants.
      fbox(fr, [0, door - 1.2], [0, GROUND], [0, 0.1], "o", "orange", 1, { o: [0, 0, Math.min(1, (door - 1.2) / 4), 1] });
      fbox(fr, [door + 1.2, L], [0, GROUND], [0, 0.1], "o", "orange", 1, { o: [0, 0, Math.min(1, (L - door - 1.2) / 4), 1] });
      fbox(fr, [door - 1.2, door + 1.2], [0, 2.8], [0.3, 0.4], "o", "door", 0.95);
      fbox(fr, [door - 1.2, door + 1.2], [2.8, GROUND], [0, 0.1], "o", "orange", 1, { o: [0, 0, 0.6, 0.25] });
      fbox(fr, [door - 1.21, door - 1.2], [0, 2.8], [0, 0.3], "r", "orange", 0.8, { r: [0, 0, 0.1, 0.7] });
      fbox(fr, [door + 1.2, door + 1.21], [0, 2.8], [0, 0.3], "l", "orange", 0.8, { l: [0, 0, 0.1, 0.7] });
      const CY = [GROUND - 0.4, GROUND - 0.1], CD = -2.4;
      fbox(fr, [-0.3, L + 0.3], CY, [CD, 0], "olr", "dark", 1);
      fbox(fr, [-0.3, L + 0.3], CY, [CD, 0], "t", "soffit", 1);
      fbox(fr, [-0.3, L + 0.3], CY, [CD, 0], "b", "soffit", 0.8);
      fbox(fr, [-0.25, L + 0.25], [CY[1], CY[1] + 1.0], [CD + 0.05, CD + 0.06], "o", "railing", 1, { o: [0, 0, Math.min(1, L / 4), 1] });
      for (let a = 0.6; a < L; a += 1.2) {
        fbox(fr, [a - 0.11, a + 0.11], [CY[1], CY[1] + 0.2], [CD + 0.15, CD + 0.37], "olrit", "pot", 1);
        fbox(fr, [a - 0.14, a + 0.14], [CY[1] + 0.2, CY[1] + 0.38], [CD + 0.12, CD + 0.4], "olrit", "leaf", 1);
      }
      // Above: green glass between white frames.
      cells(fr, 0.5, L - 0.5, PIECE, "greenGlass", 0.15, GROUND, roofY);
      for (const [s0, s1] of [[0, 0.5], [L - 0.5, L]]) fbox(fr, [s0, s1], [GROUND, H], [-0.15, 0.15], "olr", "white", 1);
      fbox(fr, [0.5, L - 0.5], [roofY, H], [-0.15, 0.15], "ob", "white", 1);
    } else if (type === "front") {
      const tower = Math.min(7, L * 0.4);
      glassTower(fr, 0, tower);
      plaster(fr, tower, L);
      fbox(fr, [tower, L], [roofY, H], [0, 0.1], "o", "plaster", 0.97, { o: [0, 0, 1, 0.2] });
      garden(fr, L);
    } else if (type === "glass") {
      glassTower(fr, 0, L);
    } else if (type === "panel") {
      cells(fr, 0, L, BAY, "panelBay");
      fbox(fr, [0, L], [roofY, H], [0, 0.1], "o", "white", 1);
    } else {
      plaster(fr, 0, L);
      fbox(fr, [0, L], [roofY, H], [0, 0.1], "o", "plaster", 0.97, { o: [0, 0, 1, 0.2] });
    }
    // Parapet: inside face and coping.
    fbox(fr, [0, L], [roofY, H], [0, 0.25], "i", "plaster", 0.85);
    fbox(fr, [0, L], [H - 0.01, H], [0, 0.25], "t", "white", 1);
  });

  // Roof and a stair room.
  roofPolygon(pts, roofY, "roof", 1, (x, z) => [(x + W / 2) / W, 1 - (z + D / 2) / D]);
  const spot = interiorPoint(pts, edges);
  if (spot && spot.clearance > 4) {
    const { x, z } = spot;
    box([x - 3, x + 3], [roofY, roofY + 3], [z - 2.5, z + 2.5], "+z -z +x -x", "plaster", 0.95);
    box([x - 3.3, x + 3.3], [roofY + 3, roofY + 3.2], [z - 2.8, z + 2.8], "+z -z +x -x +y", "white", 1);
  }
  return { facades: walls };
}
