// "modern" style: the Bangladesh Reference Institute for Chemical Measurements
// (reference photo backup/models/source/bricm/photo-1.jpg). Built along the
// footprint polygon's own edges. Beige stone cladding; large teal glass panels set
// proud of the stone; on the front (the longest wall at the entrance) the panel
// has a deep recessed window box in a stone frame and the ground floor an arched
// arcade at the entrance; stone towers with a narrow vertical glass slot; a top
// stone band with a row of small square windows, a cornice and the parapet.
//
// Facade per wall: "front", "stone", "glass" or "slot". By default: the front;
// then 14 m and longer: stone, 9-14 m: glass, shorter: slot. spec.facades
// overrides by wall number (the builder prints them: counted clockwise seen
// from above, starting at the front).
import { concrete, mix, rng, scale, valueNoise } from "./atlas.mjs";
import { interiorPoint, nearestEdge, polygonEdges, segmentDistance } from "./polygon.mjs";

export const regions = {
  glass: [0, 0, 512, 768],
  stone: [512, 0, 256, 320],
  stoneWin: [768, 0, 256, 320],
  slot: [512, 320, 256, 320],
  ground: [768, 320, 256, 320],
  entrance: [512, 640, 256, 256],
  niche: [768, 640, 256, 256],
  roof: [0, 768, 256, 256],
  sand: [256, 784, 64, 64],
  sandDark: [320, 784, 64, 64],
  white: [384, 784, 64, 64],
  dark: [448, 784, 64, 64],
  metal: [256, 848, 64, 64],
  roofbox: [320, 848, 64, 64],
  paving: [384, 848, 64, 64]
};
const SWATCH = { sand: [224, 208, 186], sandDark: [196, 180, 158], white: [236, 232, 224], dark: [58, 64, 68], metal: [128, 132, 136], roofbox: [204, 198, 188], paving: [206, 200, 188] };
export const swatches = Object.keys(SWATCH);
const SAND = [224, 208, 186];

// ---- Texture -------------------------------------------------------------------------
function paintGlass(atlas) {
  const [, , w, h] = regions.glass;
  atlas.paint(regions.glass, (x, y) => {
    const u = x / w, v = y / h;
    let c = mix([104, 186, 184], [56, 132, 136], v * 0.8 + valueNoise(x, y, 90, 3) * 0.2);
    const streak = Math.max(0, 1 - Math.abs(((u * 1.4 - v * 0.9) % 0.5) - 0.25) * 9);
    c = mix(c, [168, 214, 214], streak * 0.25);
    if (y % 64 < 2) c = [178, 204, 204]; // floor mullions
    else if (y % 32 < 1 || x % 64 < 1) c = mix(c, [150, 190, 190], 0.6); // glazing bars
    return c;
  });
}

function paintStone(atlas, region, { window = null, slot = false, seed = 11 } = {}) {
  const [, , w, h] = region;
  atlas.paint(region, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete(SAND, x, y, seed, 4, 7);
    const row = Math.floor(y / 40);
    if (y % 40 < 1.5 || (x + (row % 2) * 32) % 64 < 1.5) c = scale(c, 0.9); // panel joints
    if (window) {
      const [u0, u1, v0, v1] = window;
      if (u > u0 && u < u1 && v > v0 && v < v1) {
        const fu = (u - u0) / (u1 - u0), fv = (v - v0) / (v1 - v0);
        c = fu < 0.1 || fv > 0.88 ? [120, 116, 108] : mix([46, 58, 62], [78, 104, 108], fv); // reveal shadow, glass
      }
    }
    if (slot && u > 0.38 && u < 0.62) {
      c = mix([52, 96, 100], [86, 146, 146], v);
      if (Math.abs(u - 0.5) < 0.006 || y % 48 < 2) c = [150, 176, 176];
      if (u < 0.395 || u > 0.605) c = [120, 116, 108];
    }
    return c;
  });
}

function paintGround(atlas) {
  const [, , w, h] = regions.ground;
  atlas.paint(regions.ground, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete(SAND, x, y, 21, 4, 7);
    if (v < 0.08) c = concrete([188, 172, 150], x, y, 22, 3, 5);
    if (u > 0.08 && u < 0.92 && v > 0.1 && v < 0.8) {
      c = mix([40, 54, 58], [70, 98, 102], (v - 0.1) / 0.7);
      if (Math.abs(((u - 0.08) / 0.84 * 3) % 1 - 0.5) > 0.47 || Math.abs(v - 0.62) < 0.008) c = [140, 146, 146];
    }
    return c;
  });
}

function paintEntrance(atlas) {
  const [, , w, h] = regions.entrance;
  atlas.paint(regions.entrance, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = mix([26, 32, 36], [52, 66, 72], v);
    if (Math.abs((u * 4) % 1 - 0.5) > 0.46 || Math.abs(v - 0.72) < 0.01) c = [120, 124, 126];
    if (v > 0.84 && v < 0.87 && Math.abs((u * 4) % 1 - 0.5) < 0.06) c = [214, 198, 156]; // lights inside
    return c;
  });
}

function paintNiche(atlas) {
  const [, , w, h] = regions.niche;
  atlas.paint(regions.niche, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete([200, 186, 164], x, y, 31, 3, 5);
    if (u > 0.1 && u < 0.9 && v > 0.12 && v < 0.88) {
      c = mix([40, 70, 76], [84, 130, 134], v);
      if (Math.abs(((u - 0.1) / 0.8 * 4) % 1 - 0.5) > 0.46 || Math.abs(v - 0.5) < 0.01) c = [150, 160, 160];
    }
    return c;
  });
}

export async function paint(atlas) {
  paintGlass(atlas);
  paintStone(atlas, regions.stone);
  paintStone(atlas, regions.stoneWin, { window: [0.34, 0.66, 0.42, 0.74], seed: 13 });
  paintStone(atlas, regions.slot, { slot: true, seed: 15 });
  paintGround(atlas);
  paintEntrance(atlas);
  paintNiche(atlas);
  atlas.paint(regions.roof, (x, y) => concrete([178, 176, 170], x, y, 41, 5, 10));
  for (const [name, color] of Object.entries(SWATCH)) atlas.paint(regions[name], (x, y) => concrete(color, x, y, 60, 2, 0));
}

// ---- Geometry ------------------------------------------------------------------------
export function build(mesh, { H, W, D, spec, polygon, neighbours = [], entrance = null, entranceCoords = null }) {
  const { fbox, face, polygon: roofPolygon } = mesh;
  const { pts, edges } = polygonEdges(polygon, { neighbours });
  const GROUND = spec.groundHeight ?? 5.2, PARAPET = 1.0, BAY = 3.2;
  const roofY = H - PARAPET, TOP = roofY - (spec.topBand ?? 3.2);
  const floors = Math.max(1, Math.round((TOP - GROUND) / (spec.floorHeight ?? 3.2)));
  const f = (TOP - GROUND) / floors;
  const random = rng(23);

  // Front: the longest outer wall within 8 m of the entrance (else the nearest one).
  const point = entrance || entranceCoords;
  let front = null;
  if (point) {
    const near = edges.filter((edge) => edge.kind === "outer" && segmentDistance(point, edge.A, edge.B) < 8).sort((a, b) => b.L - a.L)[0];
    front = near ? nearestEdge(point, [near]) : nearestEdge(point, edges);
  }
  const start = front ? edges.indexOf(front.edge) : 0;
  const order = edges.map((_, i) => edges[(start + i) % edges.length]);
  const types = order.map((edge, i) => {
    if (edge.kind === "shared") return "shared";
    if (edge.kind === "inner") return "stone";
    if (spec.facades?.[i]) return spec.facades[i];
    if (edge === front?.edge) return "front";
    return edge.L >= 14 ? "stone" : edge.L >= 9 ? "glass" : "slot";
  });

  order.forEach((edge, index) => {
    const type = types[index];
    const { frame: fr, L } = edge;
    if (type === "shared" || L < 0.8) return;
    const ext = edge.convexEnd ? -0.3 : 0;
    const endFace = edge.convexEnd ? "l" : "";
    const n = Math.max(1, Math.round(L / BAY)), m = L / n;
    const cells = (a0, a1, y0, y1, region, ao = 0.92) => fbox(fr, [a0, a1], [y0, y1], [0, 0.1], "o", region, ao);

    // Proud glass panel (front and glass walls) and the arcade on the front.
    const panel = type === "front" ? [0.1 * L, 0.9 * L] : type === "glass" ? [Math.min(0.9, 0.06 * L), L - Math.min(0.9, 0.06 * L)] : null;
    let arcade = null;
    if (type === "front") {
      const count = L >= 24 ? 2 : 1, open = 3.4, pier = 1.3;
      const span = count * open + (count + 1) * pier;
      const center = Math.max(span / 2 + 0.3, Math.min(L - span / 2 - 0.3, front?.edge === edge ? front.a : L / 2));
      arcade = { a0: center - span / 2, a1: center + span / 2, count, open, pier };
    }

    // Walls: ground floor, floors, top band.
    for (let k = 0; k < n; k += 1) {
      const [a0, a1] = [k * m, (k + 1) * m];
      if (!arcade || a1 <= arcade.a0 || a0 >= arcade.a1) cells(a0, a1, 0, GROUND, "ground", 0.9);
      else {
        if (a0 < arcade.a0) cells(a0, arcade.a0, 0, GROUND, "ground", 0.9);
        if (a1 > arcade.a1) cells(arcade.a1, a1, 0, GROUND, "ground", 0.9);
      }
      for (let i = 0; i < floors; i += 1) {
        const y0 = GROUND + i * f;
        const region = type === "slot" ? (k === Math.floor(n / 2) ? "slot" : "stone") : (k % 2 ? "stoneWin" : "stone");
        if (!panel || a1 <= panel[0] || a0 >= panel[1]) cells(a0, a1, y0, y0 + f, region);
        else { // behind the glass panel: stone only outside it
          if (a0 < panel[0]) cells(a0, panel[0], y0, y0 + f, "stone");
          if (a1 > panel[1]) cells(panel[1], a1, y0, y0 + f, "stone");
        }
      }
      cells(a0, a1, TOP, roofY, "stoneWin", 0.95);
    }
    if (panel) {
      // Behind the panel the wall is not seen; the panel box stands 0.4 m proud.
      const [p0, p1] = panel;
      const y0 = GROUND + 0.3, y1 = TOP - 0.3;
      const depth = type === "front" ? 0.45 : 0.3;
      const glass = (a0, a1, b0, b1) => fbox(fr, [a0, a1], [b0, b1], [-depth, 0], "o", "glass", 1, { o: [(a0 - p0) / (p1 - p0), (b0 - y0) / (y1 - y0), (a1 - p0) / (p1 - p0), (b1 - y0) / (y1 - y0)] });
      cells(p0, p1, GROUND, TOP, "sandDark", 0.7);
      fbox(fr, [p0, p1], [y0, y1], [-depth, 0], "lrtb", "sandDark", 0.95);
      if (type === "front") {
        // Recessed window box in a stone frame, right of centre (away from the entrance side).
        const toward = front && front.a < L / 2 ? 1 : -1;
        const nw = Math.min(6, 0.2 * L), nh = Math.min(4.6, 0.3 * (y1 - y0));
        const nc = L / 2 + toward * 0.12 * L, ny = y0 + 0.62 * (y1 - y0);
        const box = [nc - nw / 2, nc + nw / 2, ny - nh / 2, ny + nh / 2];
        const fw = 0.5; // frame width
        const hole = [box[0] - fw, box[1] + fw, box[2] - fw, box[3] + fw];
        glass(p0, hole[0], y0, y1);
        glass(hole[1], p1, y0, y1);
        glass(hole[0], hole[1], y0, hole[2]);
        glass(hole[0], hole[1], hole[3], y1);
        // Frame ring standing 0.3 m proud of the glass.
        fbox(fr, [hole[0], hole[1]], [hole[2], box[2]], [-depth - 0.3, -depth], "otlrb", "white", 1);
        fbox(fr, [hole[0], hole[1]], [box[3], hole[3]], [-depth - 0.3, -depth], "otlrb", "white", 1);
        fbox(fr, [hole[0], box[0]], [box[2], box[3]], [-depth - 0.3, -depth], "olr", "white", 1);
        fbox(fr, [box[1], hole[1]], [box[2], box[3]], [-depth - 0.3, -depth], "olr", "white", 1);
        // Inside of the box, 1.8 m deep, and its back window.
        fbox(fr, [box[0] - 0.01, box[0]], [box[2], box[3]], [-depth - 0.3, 1.8], "r", "sand", 0.75);
        fbox(fr, [box[1], box[1] + 0.01], [box[2], box[3]], [-depth - 0.3, 1.8], "l", "sand", 0.75);
        fbox(fr, [box[0], box[1]], [box[2] - 0.01, box[2]], [-depth - 0.3, 1.8], "t", "sand", 0.8);
        fbox(fr, [box[0], box[1]], [box[3], box[3] + 0.01], [-depth - 0.3, 1.8], "b", "sand", 0.6);
        fbox(fr, [box[0], box[1]], [box[2], box[3]], [1.8, 1.9], "o", "niche", 0.85);
      } else glass(p0, p1, y0, y1);
    }

    if (arcade) {
      // Arches: piers, spandrels, arch soffits, jambs, the glass entrance behind.
      const { a0, count, open, pier } = arcade;
      const spring = GROUND - 0.5 - open / 2, r = open / 2, deep = 1.4;
      const P = (a, y, d) => fr.at(a, y, d);
      for (let i = 0; i <= count; i += 1) cells(a0 + i * (open + pier), a0 + i * (open + pier) + pier, 0, GROUND, "sand", 0.95);
      for (let i = 0; i < count; i += 1) {
        const o0 = a0 + pier + i * (open + pier), o1 = o0 + open, oc = (o0 + o1) / 2;
        const arch = (a) => spring + Math.sqrt(Math.max(0, r * r - (a - oc) ** 2));
        const N = 10;
        for (let s = 0; s < N; s += 1) {
          const [s0, s1] = [o0 + (open * s) / N, o0 + (open * (s + 1)) / N];
          face([P(s0, arch(s0), 0), P(s1, arch(s1), 0), P(s1, GROUND, 0), P(s0, GROUND, 0)], fr.n, "sand", 0.95);
          const sm = (s0 + s1) / 2, ym = arch(sm);
          const inward = [fr.right[0] * (oc - sm) + 0, spring - ym, fr.right[2] * (oc - sm)];
          face([P(s0, arch(s0), 0), P(s1, arch(s1), 0), P(s1, arch(s1), deep), P(s0, arch(s0), deep)], inward, "sand", 0.75);
        }
        fbox(fr, [o0 - 0.01, o0], [0, spring], [0, deep], "r", "sand", 0.8);
        fbox(fr, [o1, o1 + 0.01], [0, spring], [0, deep], "l", "sand", 0.8);
        fbox(fr, [o0, o1], [0, spring + r], [deep, deep + 0.1], "o", "entrance", 0.95);
        fbox(fr, [o0, o1], [0, 0.02], [0, deep], "t", "paving", 0.9);
      }
    }

    // Bands: plinth, cornice under the top band, parapet.
    const openings = arcade ? Array.from({ length: arcade.count }, (_, i) => arcade.a0 + arcade.pier + i * (arcade.open + arcade.pier)).map((o) => [o, o + arcade.open]) : [];
    let from = ext;
    for (const [o0, o1] of [...openings, [L, L]]) {
      fbox(fr, [from, o0], [0, 0.4], [-0.15, 0], "ot" + (from === ext ? endFace : "l") + (o0 < L ? "r" : ""), "sandDark", 0.95);
      from = o1;
    }
    fbox(fr, [ext, L], [TOP - 0.3, TOP], [-0.3, 0], "otb" + endFace, "sand", 1);
    fbox(fr, [ext, L], [roofY, H], [-0.2, 0.3], "oti" + endFace, "sand", 1);
  });

  // Roof with a plant room and a few outdoor units.
  roofPolygon(pts, roofY, "roof", 1, (x, z) => [(x + W / 2) / W, 1 - (z + D / 2) / D]);
  const spot = interiorPoint(pts, edges);
  if (spot && spot.clearance > 4) {
    const { x, z } = spot;
    mesh.box([x - 3, x + 3], [roofY, roofY + 3], [z - 2.2, z + 2.2], "+z -z +x -x +y", "roofbox", 0.95);
    for (let i = 0; i < 4; i += 1) {
      const ux = x - 3 + i * 2, uz = z + 3.2 + random();
      mesh.box([ux, ux + 1.2], [roofY, roofY + 0.9], [uz, uz + 0.8], "+z -z +x -x +y", "white", 0.9);
    }
  }
  return { facades: types.map((type, i) => `${i}:${type} ${order[i].L.toFixed(1)} m`) };
}

