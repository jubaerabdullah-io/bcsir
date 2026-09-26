// "school" style: BCSIR High School (reference photos backup/models/source/high-school/:
// photo-1 and photo-3 from the yard towards the Parents Shade, photo-2 the arcade
// building). Three parts, one atlas layout, chosen by spec.part:
//   court   (230, the U building) salmon-pink, three storeys; open corridor galleries
//           on every side facing its own courtyard (square pillars each bay, solid
//           parapets, maroon doors and windows on the corridor wall behind), plain
//           pink outer walls with grilled windows, and the cream end wall with the
//           school's name painted at the top (the outer wall nearest the building
//           spec.nameWallToward, the Parents Shade in the photos);
//   arcade  (229, the High School) cream, arched verandas with iron grilles on the
//           side facing the yard (its entrance), a white planter wall with pots in
//           front, windowed cream walls elsewhere and a terracotta west end;
//   shade   (231, the Parents Shade) the pink kiosk: roof slab with the signboard
//           (cut from photo 3) over the side facing spec.front (compass degrees),
//           dark green corner pillars, the black notice wall at the back, low pink
//           walls in front and on the south side, open to the north.
// Built along the footprint polygon's own edges (polygon.mjs); a courtyard side is
// an edge facing a point outside the footprint but inside its convex hull.
import { concrete, hash, mix, scale, valueNoise } from "./atlas.mjs";
import { nearestEdge, polygonEdges, segmentDistance, worldBearing } from "./polygon.mjs";

export const regions = {
  courtCell: [0, 0, 256, 288],
  courtGround: [256, 0, 256, 320],
  outerBay: [512, 0, 256, 288],
  outerGround: [768, 0, 256, 320],
  archBay: [0, 320, 256, 288],
  archGround: [256, 320, 256, 320],
  creamBay: [512, 320, 256, 288],
  redBay: [768, 320, 256, 288],
  shrub: [512, 608, 256, 32],
  endWall: [0, 640, 320, 384],
  sign: [320, 640, 704, 96],
  board: [320, 736, 256, 144],
  boothWall: [576, 736, 256, 112],
  fasciaSide: [576, 848, 256, 64],
  roof: [576, 912, 256, 112],
  pillar: [832, 736, 64, 288],
  pink: [896, 736, 64, 64],
  pinkShade: [960, 736, 64, 64],
  coping: [896, 800, 64, 64],
  cream: [960, 800, 64, 64],
  creamDark: [896, 864, 64, 64],
  white: [960, 864, 64, 64],
  terracotta: [896, 928, 64, 64],
  black: [960, 928, 64, 64],
  concrete: [320, 880, 64, 64],
  floor: [384, 880, 64, 64],
  pot: [448, 880, 64, 64],
  plant: [512, 880, 64, 64],
  maroon: [320, 944, 64, 64],
  green: [384, 944, 64, 64],
  ceiling: [448, 944, 64, 64],
  band: [512, 944, 64, 64]
};
const PINK = [242, 170, 158];
const CREAM = [228, 213, 172];
const TERRACOTTA = [172, 80, 60];
const MAROON = [140, 44, 48];
const SWATCH = {
  pink: PINK, pinkShade: [214, 146, 136], coping: [236, 196, 186], cream: CREAM, creamDark: [205, 190, 150],
  white: [238, 238, 232], terracotta: TERRACOTTA, black: [40, 40, 40], concrete: [190, 188, 182], floor: [178, 172, 160],
  pot: [184, 84, 56], plant: [70, 120, 60], maroon: MAROON, green: [45, 72, 62], ceiling: [236, 226, 214], band: [214, 110, 90]
};
export const swatches = Object.keys(SWATCH);
const NAME_BN = "বি.সি.এস.আই.আর উচ্চ বিদ্যালয়";

// Storeys of a part: ground floor, upper floors, roof and parapet (metres).
function levels(H, spec) {
  const PARAPET = 0.9, roofY = H - PARAPET;
  const GROUND = spec.groundHeight ?? 3.0;
  const floors = Math.max(1, Math.round((roofY - GROUND) / (spec.floorHeight ?? 2.6)));
  return { PARAPET, roofY, GROUND, floors, f: (roofY - GROUND) / floors, BAY: spec.bay ?? 3.3 };
}

// ---- Texture -------------------------------------------------------------------------
const plaster = (base, x, y, seed) => {
  let c = concrete(base, x, y, seed, 4, 7);
  return scale(c, 1 - Math.max(0, valueNoise(x, y * 0.08, 6, seed + 3) - 0.62) * 0.18); // rain streaks
};
// Cream-painted brick (the arcade building): faint courses and bond.
const brick = (base, x, y, seed) => {
  let c = plaster(base, x, y, seed);
  const row = Math.floor(y / 7);
  if (y % 7 === 0 || (x + (row % 2) * 9) % 18 === 0) c = scale(c, 0.93);
  return c;
};
// Dark window with a frame and a steel grille; (fu, fv) 0..1 across it.
function windowPixel(fu, fv, pw, ph, x, y, seed, frame = [236, 226, 214]) {
  if (fu < 5 / pw || fu > 1 - 5 / pw || fv < 5 / ph || fv > 1 - 5 / ph || Math.abs(fu - 0.5) < 2 / pw) return frame;
  let c = mix([38, 42, 46], [86, 96, 104], fv * 0.7 + hash(x, y, seed) * 0.05);
  if (x % 11 < 2) c = [30, 30, 30];
  return c;
}
// Rectangle test: (u, v) in [u0, u1] x [v0, v1] -> local 0..1 or null.
const within = (u, v, u0, u1, v0, v1) => (u >= u0 && u <= u1 && v >= v0 && v <= v1 ? [(u - u0) / (u1 - u0), (v - v0) / (v1 - v0)] : null);

// Corridor wall behind a gallery (pink): a maroon door and a window; the lower part
// behind the parapet (upper floors) and the ceiling are in shadow.
function paintCorridor(atlas, region, { ground, parapet, seed }) {
  const [, , w, h] = region;
  atlas.paint(region, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = plaster(PINK, x, y, seed);
    if (!ground && v < parapet) c = scale(c, 0.78);
    if (ground && v < 0.1) c = concrete([44, 44, 42], x, y, seed + 1, 3, 3);
    const door = within(u, v, 0.1, 0.38, ground ? 0.1 : 0.02, 0.78);
    if (door) c = door[0] < 0.06 || door[0] > 0.94 || door[1] > 0.96 ? [232, 222, 210] : scale(MAROON, 0.92 + 0.08 * (Math.floor(door[1] * 3) % 2));
    const win = within(u, v, 0.52, 0.86, ground ? 0.34 : Math.max(0.36, parapet + 0.02), 0.74);
    if (win) c = windowPixel(win[0], win[1], 0.34 * w, 0.38 * h, x, y, seed + 2, [196, 70, 64]);
    if (v > 0.86) c = mix(c, scale(c, 0.62), (v - 0.86) / 0.14);
    return c;
  });
}

// Outer pink wall bay with a grilled window under a sunshade.
function paintOuter(atlas, region, { ground, seed }) {
  const [, , w, h] = region;
  atlas.paint(region, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = plaster(PINK, x, y, seed);
    if (ground && v < 0.1) c = concrete([44, 44, 42], x, y, seed + 1, 3, 3);
    const win = within(u, v, 0.26, 0.74, ground ? 0.3 : 0.3, 0.74);
    if (win) c = windowPixel(win[0], win[1], 0.48 * w, 0.44 * h, x, y, seed + 2);
    if (u > 0.22 && u < 0.78 && v > 0.76 && v < 0.81) c = scale(PINK, 0.84); // sunshade
    if (u > 0.22 && u < 0.78 && v > 0.74 && v < 0.76) c = scale(PINK, 0.62); // its shadow
    return c;
  });
}

// Arcade bay: cream brick with a round-headed opening, the dark veranda behind an
// iron lattice; heights in metres (bay width bw, height bh).
function paintArch(atlas, region, { bw, bh, sill, seed }) {
  const [, , w, h] = region;
  const r = Math.min(bw * 0.3, (bh - sill) * 0.42), cx = bw / 2, spring = bh - 0.22 - r;
  atlas.paint(region, (x, y) => {
    const X = (x / w) * bw, Yv = (1 - y / h) * bh;
    let c = brick(CREAM, x, y, seed);
    const dx = Math.abs(X - cx);
    const inOpening = dx < r && Yv > sill && (Yv < spring || Math.hypot(X - cx, Yv - spring) < r);
    const inFrame = dx < r + 0.08 && Yv > sill - 0.06 && (Yv < spring || Math.hypot(X - cx, Yv - spring) < r + 0.08);
    if (inFrame && !inOpening) c = [242, 234, 206];
    if (inOpening) {
      c = mix([54, 50, 44], [96, 88, 76], valueNoise(x, y, 28, seed + 1) * 0.5 + (Yv - sill) / (bh - sill) * 0.3);
      const px = x * 0.9, py = y;
      if (Math.abs(((px + py) % 16) - 8) < 1.2 || Math.abs(((px - py + 1600) % 16) - 8) < 1.2) c = [34, 34, 32]; // lattice
    }
    if (Yv < 0.12) c = scale(c, 0.82);
    return c;
  });
}

function paintCreamBay(atlas) {
  const [, , w, h] = regions.creamBay;
  atlas.paint(regions.creamBay, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = brick(CREAM, x, y, 81);
    const win = within(u, v, 0.28, 0.72, 0.3, 0.76);
    if (win) c = windowPixel(win[0], win[1], 0.44 * w, 0.46 * h, x, y, 82);
    if (u > 0.25 && u < 0.75 && v > 0.27 && v < 0.3) c = [240, 232, 206];
    return c;
  });
}

// Terracotta brick end with a grilled balcony opening.
function paintRedBay(atlas) {
  const [, , w, h] = regions.redBay;
  atlas.paint(regions.redBay, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete(TERRACOTTA, x, y, 91, 6, 8);
    if (y % 8 === 0 || (x + (Math.floor(y / 8) % 2) * 10) % 20 === 0) c = scale(c, 0.8);
    const open = within(u, v, 0.14, 0.86, 0.34, 0.88);
    if (open) {
      c = mix([40, 36, 34], [70, 62, 56], open[1]);
      if (x % 12 < 2 || y % 24 < 2) c = [26, 26, 26];
    }
    if (u > 0.1 && u < 0.9 && v > 0.3 && v < 0.34) c = [214, 204, 190]; // balcony slab edge
    return c;
  });
}

// The cream end wall with the school's name at the top and a row of small vents.
async function paintEndWall(atlas) {
  const [, , w, h] = regions.endWall;
  atlas.paint(regions.endWall, (x, y) => {
    const v = 1 - y / h;
    let c = plaster(CREAM, x, y, 101);
    if (v > 0.965) c = mix(c, [120, 124, 112], 0.55); // weathered coping
    else if (v > 0.9) c = mix(c, [150, 150, 132], Math.max(0, valueNoise(x, y * 0.2, 10, 102) - 0.45) * 0.8);
    for (let k = 0; k < 4; k += 1) {
      const cx = 0.3 + k * 0.13;
      if (Math.abs(x / w - cx) < 0.012 && Math.abs(v - 0.835) < 0.008) c = [36, 34, 30];
    }
    return c;
  });
  await atlas.text(regions.endWall, [{ text: NAME_BN, height: 0.062, top: 0.045, color: "#2b2926", bold: true, maxWidth: 0.9 }]);
}

// Signboard of the Parents Shade: rectified from the photo (the tree over its top
// right corner painted out), or the name in blue on the pink board without it.
async function paintSign(atlas, { spec, photo }) {
  const board = [226, 186, 188];
  const sign = spec.sign || {};
  if (sign.photo && await atlas.photo(regions.sign, photo(sign.photo), sign.quad, { sharpen: 0.5 })) {
    atlas.paint(regions.sign, (x, y, w, h, c) => {
      const leaf = (c[1] > c[0] + 6 && c[1] > c[2] + 6) || Math.max(...c) < 110, sky = Math.min(...c) > 214 && Math.max(...c) - Math.min(...c) < 20;
      return x > w * 0.55 && y < h * 0.42 && (leaf || sky) ? concrete(board, x, y, 111, 3, 4) : c;
    });
    return;
  }
  if (sign.photo) console.warn(`  ${sign.photo} not found: drawing the signboard from the name.`);
  atlas.paint(regions.sign, (x, y) => concrete(board, x, y, 111, 3, 4));
  await atlas.text(regions.sign, [
    { text: "বি সি এস আই আর উচ্চ বিদ্যালয়", height: 0.58, top: 0.06, color: "#1f8fd0", bold: true },
    { text: "সায়েন্স ল্যাবরেটরি ক্যাম্পাস, নিউমার্কেট, ঢাকা-১২০৫।  www.bcsirscd.edu.bd", height: 0.2, top: 0.72, color: "#202020" }
  ]);
}

function paintBooth(atlas) {
  // Black notice wall with pinned papers and a poster.
  atlas.paint(regions.board, (x, y, w, h) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete([34, 34, 32], x, y, 121, 3, 5);
    const cell = [Math.floor(u * 9), Math.floor(v * 4)];
    const r = hash(cell[0], cell[1], 122);
    const fu = (u * 9) % 1, fv = (v * 4) % 1;
    if (r > 0.55 && fu > 0.15 && fu < 0.75 && fv > 0.2 && fv < 0.7 && v < 0.85) c = r > 0.93 ? [120, 176, 70] : [214, 212, 204];
    if (v > 0.9) c = scale(c, 0.7);
    return c;
  });
  atlas.paint(regions.boothWall, (x, y, w, h) => {
    const v = 1 - y / h;
    let c = plaster([226, 150, 118], x, y, 131);
    if (v < 0.14) c = concrete([40, 44, 40], x, y, 132, 3, 4);
    else if (v < 0.4) c = scale(c, 1 - (0.4 - v) * 0.25); // splash grime
    return c;
  });
  atlas.paint(regions.fasciaSide, (x, y, w, h) => (1 - y / h < 0.3 ? concrete(SWATCH.band, x, y, 141, 3, 5) : concrete([226, 186, 188], x, y, 142, 3, 5)));
  atlas.paint(regions.pillar, (x, y, w, h) => {
    let c = concrete(SWATCH.green, x, y, 151, 5, 6);
    if (y % 20 === 0) c = scale(c, 0.8); // tiles
    const v = 1 - y / h;
    if (v > 0.45 && v < 0.62 && x > 8 && x < 56) c = hash(Math.floor(x / 6), Math.floor(y / 6), 152) > 0.3 ? [224, 222, 212] : [150, 150, 146];
    if (v > 0.3 && v < 0.38 && x > 12 && x < 50) c = [128, 184, 72];
    return c;
  });
}

export async function paint(atlas, ctx) {
  const { spec, H, W, D } = ctx;
  const lv = levels(H, spec);
  const part = spec.part;
  if (part === "court") {
    paintCorridor(atlas, regions.courtCell, { ground: false, parapet: 1.0 / lv.f, seed: 11 });
    paintCorridor(atlas, regions.courtGround, { ground: true, parapet: 0, seed: 13 });
    paintOuter(atlas, regions.outerBay, { ground: false, seed: 21 });
    paintOuter(atlas, regions.outerGround, { ground: true, seed: 23 });
    await paintEndWall(atlas);
  }
  if (part === "arcade") {
    paintArch(atlas, regions.archBay, { bw: lv.BAY, bh: lv.f, sill: 0.95, seed: 31 });
    paintArch(atlas, regions.archGround, { bw: lv.BAY, bh: lv.GROUND, sill: 0.1, seed: 33 });
    paintCreamBay(atlas);
    paintRedBay(atlas);
    // Potted plants: leaves in light and shade.
    atlas.paint(regions.shrub, (x, y) => mix([44, 88, 40], [110, 160, 70], valueNoise(x, y, 5, 191) * 0.7 + hash(x, y, 192) * 0.3));
  }
  if (part === "shade") {
    await paintSign(atlas, ctx);
    paintBooth(atlas);
  }
  // Flat roof: weathered concrete, scaled to the footprint so stains stay round.
  const [, , rw, rh] = regions.roof;
  atlas.paint(regions.roof, (x, y) => {
    const my = (y * D * rw) / (W * rh);
    let c = concrete([172, 170, 162], x, my, 161, 5, 10);
    return scale(c, 1 - 0.12 * Math.max(0, valueNoise(x, my, 30, 162) - 0.5) / 0.5);
  });
  for (const [name, color] of Object.entries(SWATCH)) atlas.paint(regions[name], (x, y) => concrete(color, x, y, 170, 2, 0));
}

// ---- Geometry ------------------------------------------------------------------------
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => list.reduce((hull, q) => { while (hull.length >= 2 && turn(hull[hull.length - 2], hull[hull.length - 1], q) <= 0) hull.pop(); hull.push(q); return hull; }, []);
  const lower = half(p), upper = half(p.reverse());
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
const insidePolygon = (point, pts) => {
  let result = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > point[1]) !== (zj > point[1]) && point[0] < (xj - xi) * (point[1] - zi) / (zj - zi) + xi) result = !result;
  }
  return result;
};
const bearingOff = (edge, bearing, rotation) => { const d = Math.abs(worldBearing(edge.n, rotation) - bearing) % 360; return Math.min(d, 360 - d); };

// Parapet and coping on the roof along an edge (the outer face left out where a
// wall below already reaches the top).
function roofParapet(mesh, edge, { roofY, H }, { outer = true, s0 = 0 } = {}) {
  const { frame: fr, L } = edge;
  mesh.fbox(fr, [s0, L], [roofY, H - 0.06], [0, 0.25], (outer ? "o" : "") + "i", "pink", 0.95);
  mesh.fbox(fr, [s0, L], [H - 0.06, H], [-0.04, 0.29], "ot", "coping", 1);
}

function buildCourt(mesh, ctx) {
  const { H, W, D, spec, polygon, neighbours = [] } = ctx;
  const { fbox, polygon: flat } = mesh;
  const lv = levels(H, spec);
  const { roofY, GROUND, floors, f, BAY } = lv;
  const { pts, edges } = polygonEdges(polygon, { neighbours });
  const hull = convexHull(pts);
  const G = 1.8; // gallery depth
  const OUT = 0.1;
  for (const edge of edges) {
    const mid = [(edge.A[0] + edge.B[0]) / 2 + edge.n[0] * 1.5, (edge.A[1] + edge.B[1]) / 2 + edge.n[1] * 1.5];
    edge.court = edge.kind !== "shared" && insidePolygon(mid, hull) && !insidePolygon(mid, pts);
  }
  // The cream end wall: the outer wall nearest the given building (the Parents Shade).
  const toward = neighbours.find((item) => item.id === spec.nameWallToward);
  const target = toward ? toward.segments.reduce((sum, [P]) => [sum[0] + P[0] / toward.segments.length, sum[1] + P[1] / toward.segments.length], [0, 0]) : null;
  const nameEdge = target ? edges.filter((edge) => !edge.court && edge.kind !== "shared").sort((a, b) => segmentDistance(target, a.A, a.B) - segmentDistance(target, b.A, b.B))[0] : null;

  edges.forEach((edge, i) => {
    const { frame: fr, L, kind } = edge;
    if (kind === "shared" || L < 0.8) return;
    const prev = edges[(i - 1 + edges.length) % edges.length], next = edges[(i + 1) % edges.length];
    const n = Math.max(1, Math.round(L / BAY)), m = L / n;
    if (edge === nameEdge) {
      fbox(fr, [0, L], [0, H], [0, 0.1], "o", "endWall", 0.95);
      roofParapet(mesh, edge, lv, { outer: false });
      return;
    }
    if (edge.court) {
      // a = 0 is at B: walls and slabs reach round a reflex corner into the next gallery.
      const reflexB = next.court && !edge.convexEnd, reflexA = prev.court && !prev.convexEnd;
      const w0 = reflexB ? -G : 0, w1 = reflexA ? L + G : L, s0 = reflexB ? -G : 0;
      const wn = Math.max(1, Math.round((w1 - w0) / BAY)), wm = (w1 - w0) / wn;
      for (let k = 0; k < wn; k += 1) {
        const [a0, a1] = [w0 + k * wm, w0 + (k + 1) * wm];
        fbox(fr, [a0, a1], [0, GROUND], [G, G + 0.1], "o", "courtGround", 0.8);
        for (let j = 0; j < floors; j += 1) fbox(fr, [a0, a1], [GROUND + j * f, GROUND + (j + 1) * f], [G, G + 0.1], "o", "courtCell", 0.8);
      }
      for (let k = 0; k <= n; k += 1) {
        const a = Math.max(0.18, Math.min(L - 0.18, k * m));
        fbox(fr, [a - 0.18, a + 0.18], [0.25, roofY - 0.2], [0, 0.36], "olri", "pink", 0.95);
      }
      fbox(fr, [s0, L], [0, 0.25], [0, G], "ot", "concrete", 0.9);
      for (let j = 0; j < floors; j += 1) {
        // Slab under upper storey j: its edge, the gallery's ceiling below and floor
        // above, and the gallery's parapet on it.
        const y = GROUND + j * f;
        fbox(fr, [s0, L], [y - 0.22, y], [0, G], "o", "pink", 0.95);
        fbox(fr, [s0, L], [y - 0.22, y], [0, G], "b", "ceiling", 0.7);
        fbox(fr, [s0, L], [y - 0.22, y], [0, G], "t", "floor", 0.95);
        fbox(fr, [reflexB ? -0.12 : 0, L], [y, y + 1.0], [0, 0.12], "oi", "pink", 0.95);
        fbox(fr, [reflexB ? -0.12 : 0, L], [y + 0.96, y + 1.0], [-0.02, 0.14], "t", "coping", 1);
      }
      fbox(fr, [s0, L], [roofY - 0.22, roofY], [0, G], "ob", "ceiling", 0.7);
      roofParapet(mesh, edge, lv, { s0: reflexB ? -0.25 : 0 });
      return;
    }
    // Outer wall: grilled windows, floor bands, parapet.
    const ext = edge.convexEnd ? -OUT : 0, endFace = edge.convexEnd ? "l" : "";
    for (let k = 0; k < n; k += 1) {
      const [a0, a1] = [k * m, (k + 1) * m];
      fbox(fr, [a0, a1], [0, GROUND], [0, 0.1], "o", "outerGround", 0.92);
      for (let j = 0; j < floors; j += 1) fbox(fr, [a0, a1], [GROUND + j * f, GROUND + (j + 1) * f], [0, 0.1], "o", "outerBay", 0.9);
    }
    for (let j = 0; j < floors; j += 1) fbox(fr, [ext, L], [GROUND + j * f - 0.18, GROUND + j * f], [-OUT, 0], "otb" + endFace, "pinkShade", 0.95);
    roofParapet(mesh, edge, lv);
  });
  flat(pts, roofY, "roof", 1, (x, z) => [(x + W / 2) / W, 1 - (z + D / 2) / D]);
  return { edges: edges.map((edge) => (edge === nameEdge ? "name" : edge.court ? "court" : edge.kind)) };
}

function buildArcade(mesh, ctx) {
  const { H, W, D, spec, polygon, neighbours = [], entranceCoords, rotation = 0 } = ctx;
  const { fbox, polygon: flat } = mesh;
  const lv = levels(H, spec);
  const { roofY, GROUND, floors, f, BAY } = lv;
  const { pts, edges } = polygonEdges(polygon, { neighbours });
  const front = entranceCoords ? nearestEdge(entranceCoords, edges, ["outer", "inner"])?.edge : edges[0];
  const west = edges.slice().sort((a, b) => bearingOff(a, 270, rotation) - bearingOff(b, 270, rotation))[0];
  const OUT = 0.14;
  for (const edge of edges) {
    const { frame: fr, L, kind } = edge;
    if (kind === "shared" || L < 0.8) continue;
    const n = Math.max(1, Math.round(L / BAY)), m = L / n;
    const ext = edge.convexEnd ? -OUT : 0, endFace = edge.convexEnd ? "l" : "";
    for (let k = 0; k < n; k += 1) {
      const [a0, a1] = [k * m, (k + 1) * m];
      const c = fr.at((a0 + a1) / 2, 0, 0);
      const red = edge === west || (edge === front && segmentDistance([c[0], c[2]], west.A, west.B) < 4.6);
      const bay = edge === front && !red ? "arch" : red ? "red" : "cream";
      fbox(fr, [a0, a1], [0, GROUND], [0, 0.1], "o", bay === "arch" ? "archGround" : bay === "red" ? "redBay" : "creamBay", 0.92);
      for (let j = 0; j < floors; j += 1) fbox(fr, [a0, a1], [GROUND + j * f, GROUND + (j + 1) * f], [0, 0.1], "o", bay === "arch" ? "archBay" : bay === "red" ? "redBay" : "creamBay", 0.9);
    }
    // Pilasters between the arches, floor bands all round.
    if (edge === front) for (let k = 1; k < n; k += 1) fbox(fr, [k * m - 0.16, k * m + 0.16], [0, roofY], [-OUT, 0], "olr", "cream", 0.95);
    for (let j = 0; j < floors; j += 1) fbox(fr, [ext, L], [GROUND + j * f - 0.2, GROUND + j * f], [-OUT - 0.04, 0], "otb" + endFace, "creamDark", 0.95);
    fbox(fr, [ext, L], [0, 0.35], [-OUT, 0], "ot" + endFace, "creamDark", 0.9);
    mesh.fbox(fr, [0, L], [roofY, H - 0.06], [0, 0.25], "o", edge === west ? "terracotta" : "cream", 0.95);
    mesh.fbox(fr, [0, L], [roofY, H - 0.06], [0, 0.25], "i", "cream", 0.85);
    mesh.fbox(fr, [0, L], [H - 0.06, H], [-0.04, 0.29], "ot", "white", 1);
    if (edge === front) {
      // White planter wall along the arcade with potted plants in front of it.
      const [p0, p1] = [0.8, L - 0.8];
      fbox(fr, [p0, p1], [0, 0.72], [-1.3, -1.05], "oitlr", "white", 0.95);
      for (let a = p0 + 0.3; a + 0.34 <= p1; a += 0.62) {
        fbox(fr, [a, a + 0.34], [0, 0.34], [-1.7, -1.36], "olrt", "pot", 0.9);
        const r = hash(Math.round(a * 10), 1, 182), grow = 0.06 * hash(Math.round(a * 10), 2, 183);
        if (hash(Math.round(a * 10), 0, 181) > 0.3) fbox(fr, [a - grow, a + 0.34 + grow], [0.34, 0.5 + r * 0.4], [-1.68 - grow, -1.38 + grow], "olrt", "shrub", 0.85);
      }
    }
  }
  flat(pts, roofY, "roof", 1, (x, z) => [(x + W / 2) / W, 1 - (z + D / 2) / D]);
  return { edges: edges.map((edge) => (edge === front ? "arcade" : edge === west ? "west" : edge.kind)) };
}

function buildShade(mesh, ctx) {
  const { W, D, H, spec, polygon, rotation = 0 } = ctx;
  const { fbox, polygon: flat } = mesh;
  const { pts, edges } = polygonEdges(polygon, {});
  const sides = edges.filter((edge) => edge.L >= 0.8);
  const front = sides.slice().sort((a, b) => bearingOff(a, spec.front ?? 90, rotation) - bearingOff(b, spec.front ?? 90, rotation))[0];
  const back = sides.slice().sort((a, b) => bearingOff(a, (spec.front ?? 90) + 180, rotation) - bearingOff(b, (spec.front ?? 90) + 180, rotation))[0];
  const open = sides.filter((edge) => edge !== front && edge !== back).sort((a, b) => bearingOff(a, 0, rotation) - bearingOff(b, 0, rotation))[0];
  const CEIL = H - 1.0, P = 0.36;
  const uv = (x, z) => [(x + W / 2) / W, 1 - (z + D / 2) / D];
  for (const edge of sides) {
    const { frame: fr, L } = edge;
    // Corner pillar at this edge's B end (a = 0); every corner is one edge's B end.
    fbox(fr, [0, P], [0, CEIL], [0, P], "olri", "pillar", 0.95);
    if (edge === front) {
      fbox(fr, [0, L], [CEIL + 0.3, H], [-0.12, 0], "o", "sign", 1);
      fbox(fr, [0, L], [CEIL, CEIL + 0.3], [-0.12, 0], "o", "band", 0.95);
      fbox(fr, [0, L], [CEIL, H], [-0.12, 0], "tb", "band", 0.9);
    } else {
      fbox(fr, [0, L], [CEIL, H], [0, 0.02], "o", "fasciaSide", 0.95);
    }
    if (edge === back) {
      fbox(fr, [P, L - P], [0, CEIL], [0.04, 0.24], "o", "boothWall", 0.92);
      fbox(fr, [P, L - P], [0, CEIL], [0.04, 0.24], "i", "board", 0.85);
    } else if (edge !== open) {
      fbox(fr, [P, L - P], [0, 1.0], [0.06, 0.26], "oi", "boothWall", 0.92);
      fbox(fr, [P, L - P], [0.96, 1.0], [0.04, 0.28], "t", "coping", 1);
    }
    fbox(fr, [0, L], [0, 0.12], [0, 0.01], "o", "black", 0.9);
  }
  flat(pts, H, "roof", 1, uv);
  flat(pts, CEIL, "ceiling", 0.85, uv, -1);
  flat(pts, 0.12, "floor", 0.9, uv);
  return { edges: sides.map((edge) => (edge === front ? "sign" : edge === back ? "notice wall" : edge === open ? "open" : "low wall")) };
}

export function build(mesh, ctx) {
  const part = ctx.spec.part;
  if (part === "court") return buildCourt(mesh, ctx);
  if (part === "arcade") return buildArcade(mesh, ctx);
  if (part === "shade") return buildShade(mesh, ctx);
  throw new Error(`${ctx.spec.name}: unknown school part "${part}"`);
}
