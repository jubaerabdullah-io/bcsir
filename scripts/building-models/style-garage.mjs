// "garage" style: the garage beside INARS (reference photo
// backup/models/source/garage/photo-1.png). An open car shed on the footprint
// rectangle: a flat concrete slab with a thick weathered fascia on square columns,
// open at the front (the entrance side) and at the back, a walled store room with a
// door at the right end, a concrete floor, and the white jeep with its black bull bar
// parked in the first bay.
import { concrete, hash, mix, scale, valueNoise } from "./atlas.mjs";

export const atlasSize = 512;
export const regions = {
  fascia: [16, 16, 480, 64],
  wall: [16, 112, 192, 160],
  floor: [240, 112, 256, 160],
  room: [16, 304, 192, 160],
  concrete: [256, 320, 32, 32],
  soffit: [320, 320, 32, 32],
  roofTop: [384, 320, 32, 32],
  white: [256, 400, 32, 32],
  glass: [320, 400, 32, 32],
  black: [384, 400, 32, 32],
  door: [448, 400, 32, 32],
  cabin: [16, 480, 128, 24]
};
const SWATCH = { concrete: [176, 172, 164], soffit: [198, 194, 186], roofTop: [132, 130, 124], white: [232, 232, 226], glass: [44, 52, 60], black: [26, 26, 28], door: [70, 62, 56] };
export const swatches = Object.keys(SWATCH);

// Weathered concrete: blotches, dark rain streaks running down from the top.
function weathered(base, x, y, w, h, seed, streaks = 0.25) {
  let c = concrete(base, x, y, seed, 5, 10);
  const streak = valueNoise(x * 0.9, y * 0.05, 4, seed + 1);
  c = scale(c, 1 - Math.max(0, streak - 0.55) * streaks * (1 - y / h * 0.5));
  if (valueNoise(x, y, 30, seed + 2) > 0.72) c = mix(c, [96, 100, 88], 0.3); // damp, algae
  return c;
}

export async function paint(atlas) {
  atlas.paint(regions.fascia, (x, y, w, h) => weathered([184, 180, 172], x, y, w, h, 11, 0.4));
  atlas.paint(regions.wall, (x, y, w, h) => weathered([196, 192, 182], x, y, w, h, 21, 0.3));
  atlas.paint(regions.room, (x, y, w, h) => {
    let c = weathered([204, 198, 186], x, y, w, h, 31, 0.5);
    if (y > h * 0.86) c = scale(c, 0.8); // splashed plinth
    return c;
  });
  // Jeep cabin side: dark windows between white pillars.
  atlas.paint([8, 472, 144, 40], (x, y) => { const u = (x - 8) / 128, v = 1 - (y - 8) / 24; return v > 0.15 && v < 0.9 && [0.06, 0.3, 0.55, 0.8].every((p) => Math.abs(u - p) > 0.03) && u > 0.03 && u < 0.97 ? [44, 56, 66] : [232, 232, 226]; });
  atlas.paint(regions.floor, (x, y) => {
    let c = concrete([168, 162, 150], x, y, 41, 6, 10);
    if (valueNoise(x, y, 10, 42) > 0.8) c = scale(c, 0.9); // oil stains
    if (hash(x, y, 43) > 0.995) c = [120, 110, 96]; // leaves, grit
    return c;
  });
  for (const [name, color] of Object.entries(SWATCH)) {
    const [x0, y0, w, h] = regions[name];
    atlas.paint([x0 - 8, y0 - 8, w + 16, h + 16], (x, y) => scale(color, 1 + (hash(x, y, 60) - 0.5) * 0.04));
  }
}

// ---- Geometry ------------------------------------------------------------------------
// Front (+Z): the open side at the entrance; the store room is at the right end (+X).
export function build(mesh, { W, D, H }) {
  const { box, rect } = mesh;
  const Y = [0, 1, 0];
  const SLAB = [H - 0.4, H], OVER = 0.3, COL = 0.35, ROOM = Math.min(4.2, W * 0.25);
  const [x0, x1, z0, z1] = [-W / 2, W / 2, -D / 2, D / 2];

  rect([0, 0.03, 0], Y, [1, 0, 0], W, D, "floor", 1);
  // Slab: weathered fascia all round, pale soffit, dark top.
  const sx = [x0 - OVER, x1 + OVER], sz = [z0 - OVER, z1 + OVER];
  rect([0, (SLAB[0] + SLAB[1]) / 2, sz[1]], [0, 0, 1], [1, 0, 0], sx[1] - sx[0], 0.4, "fascia", 1);
  rect([0, (SLAB[0] + SLAB[1]) / 2, sz[0]], [0, 0, -1], [-1, 0, 0], sx[1] - sx[0], 0.4, "fascia", 1);
  rect([sx[1], (SLAB[0] + SLAB[1]) / 2, 0], [1, 0, 0], [0, 0, -1], sz[1] - sz[0], 0.4, "fascia", 1, [0, 0, 0.6, 1]);
  rect([sx[0], (SLAB[0] + SLAB[1]) / 2, 0], [-1, 0, 0], [0, 0, 1], sz[1] - sz[0], 0.4, "fascia", 1, [0.4, 0, 1, 1]);
  box(sx, SLAB, sz, "-y", "soffit", 0.8);
  box(sx, SLAB, sz, "+y", "roofTop", 1);

  // Columns along the open front and back, in bays of about 5 m.
  const open = [x0, x1 - ROOM];
  const bays = Math.max(1, Math.round((open[1] - open[0]) / 5));
  for (let i = 0; i <= bays; i += 1) {
    const x = Math.min(open[1] - COL / 2, Math.max(open[0] + COL / 2, open[0] + ((open[1] - open[0]) * i) / bays));
    for (const z of [z1 - COL / 2, z0 + COL / 2]) box([x - COL / 2, x + COL / 2], [0, SLAB[0]], [z - COL / 2, z + COL / 2], "+x -x +z -z", "concrete", 0.95);
  }

  // Store room at the right end: stained walls, a door in its front.
  const rx = [x1 - ROOM, x1];
  rect([(rx[0] + rx[1]) / 2, SLAB[0] / 2, z1], [0, 0, 1], [1, 0, 0], ROOM, SLAB[0], "room", 0.95);
  rect([(rx[0] + rx[1]) / 2, SLAB[0] / 2, z0], [0, 0, -1], [-1, 0, 0], ROOM, SLAB[0], "room", 0.9);
  rect([x1, SLAB[0] / 2, 0], [1, 0, 0], [0, 0, -1], D, SLAB[0], "wall", 0.9);
  rect([rx[0], SLAB[0] / 2, 0], [-1, 0, 0], [0, 0, 1], D, SLAB[0], "wall", 0.85);
  rect([rx[0] + ROOM * 0.62, 1.05, z1 + 0.02], [0, 0, 1], [1, 0, 0], 1.0, 2.1, "door", 0.9);

  // The white jeep in the first bay, facing out, and its black bull bar.
  const cx = open[0] + (open[1] - open[0]) / bays / 2, cz = z1 - 3.0, len = 4.6, wid = 1.8;
  const [f, b] = [cz + len / 2, cz - len / 2];
  box([cx - wid / 2, cx + wid / 2], [0.4, 1.15], [b, f], "+x -x +z -z +y", "white", 1);
  box([cx - wid / 2 + 0.05, cx + wid / 2 - 0.05], [1.15, 1.85], [b + 0.2, f - 1.6], "+x -x", "cabin", 1);
  box([cx - wid / 2 + 0.05, cx + wid / 2 - 0.05], [1.15, 1.85], [b + 0.2, f - 1.6], "+z -z", "glass", 1);
  box([cx - wid / 2 + 0.05, cx + wid / 2 - 0.05], [1.85, 1.95], [b + 0.2, f - 1.6], "+y", "white", 1);
  for (const [wx, wz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const x = cx + wx * (wid / 2 - 0.02), z = cz + wz * (len / 2 - 0.85);
    box([x - 0.14, x + 0.14], [0.03, 0.75], [z - 0.37, z + 0.37], "+x -x +z -z", "black", 1);
  }
  box([cx - wid / 2 + 0.1, cx + wid / 2 - 0.1], [0.35, 1.0], [f, f + 0.25], "+x -x +z +y", "black", 1);
  return { facades: [`open front, ${bays} bays of ${((open[1] - open[0]) / bays).toFixed(1)} m, store room ${ROOM.toFixed(1)} m at the right end`] };
}
