// Walking grid of one floor (pure, tested with node --test).
//
// A floor plan has no routing lines: it has corridor polygons. This module turns
// the walkable area into a grid of small cells (0.5 m) and finds the shortest way
// across it, so a floor needs nothing more than corridor.geojson to be routable.
//
//   walkable  polygons that can be walked on (the corridors and lobbies; for a
//             floor without a corridor file, the floor outline)
//   blocked   polygons cut out of them (for a floor without a corridor file, its rooms)
//
// A cell is walkable when its centre is inside a walkable polygon and inside no
// blocked one. The grid is turned to the direction of the floor's walls, and steps
// go to the 4 side neighbours only, so a route is made of straight runs along and
// across the corridors, with square corners: it never cuts a corner or crosses a
// room. Cells beside a wall cost more, which keeps routes in the middle of a
// corridor, and every turn costs a little, which keeps them from zigzagging.
import { createLocalFrame, distance, polylineLength } from "../utils/local-frame.js";

const MAX_CELLS = 600000;
const TURN_COST_M = 1.5; // a turn counts as this much walking
const STEPS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
// Cost factor of a cell by its distance from the nearest wall, in cells.
const CLEARANCE_COST = [0, 3, 1.5];

// Even-odd scanline fill of a polygon (rings in local metres) into `target`.
function fillPolygon(rings, target, value, { minX, minY, cols, rows, size }) {
  const crossings = [];
  for (let row = 0; row < rows; row += 1) {
    const y = minY + (row + 0.5) * size;
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y)) crossings.push((xj - xi) * (y - yi) / (yj - yi) + xi);
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] - minX) / size - 0.5));
      const to = Math.min(cols - 1, Math.floor((crossings[k + 1] - minX) / size - 0.5));
      for (let col = from; col <= to; col += 1) target[row * cols + col] = value;
    }
  }
}

function pointToRings(point, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      const dx = bx - ax, dy = by - ay;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / length)) : 0;
      best = Math.min(best, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)));
    }
  }
  return best;
}

// Direction (radians) most of the outline runs along or across: each edge votes
// with its length, and directions a quarter turn apart are the same.
function dominantAngle(polygons) {
  let c = 0, s = 0;
  for (const rings of polygons) for (const ring of rings) {
    for (let i = 1; i < ring.length; i += 1) {
      const dx = ring[i][0] - ring[i - 1][0], dy = ring[i][1] - ring[i - 1][1];
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      const angle = 4 * Math.atan2(dy, dx);
      c += length * Math.cos(angle);
      s += length * Math.sin(angle);
    }
  }
  return Math.atan2(s, c) / 4;
}

// Ends a list of corner points at `target` itself (a door, a lift: a place beside
// the last cell, not on a cell centre), keeping every step along an axis. A last
// run that leads straight to the target is moved sideways onto its line; one that
// passes it stops level with it and turns to it.
function attach(points, target) {
  const last = points[points.length - 1];
  const dx = target[0] - last[0], dy = target[1] - last[1];
  if (Math.hypot(dx, dy) < 0.02) return;
  const axis = Math.abs(dx) >= Math.abs(dy) ? 0 : 1; // the target is approached along this axis
  const side = 1 - axis;
  const before = points[points.length - 2];
  const run = before ? (Math.abs(last[0] - before[0]) >= Math.abs(last[1] - before[1]) ? 0 : 1) : -1;
  if (run === axis && points.length > 2) {
    before[side] = target[side];
    last[side] = target[side];
    last[axis] = target[axis];
    return;
  }
  if (run === side) last[side] = target[side];
  else if (Math.abs(target[side] - last[side]) >= 0.02) { const corner = [...last]; corner[side] = target[side]; points.push(corner); }
  points.push([target[0], target[1]]);
}

// Binary min-heap of cell indices keyed by a Float32Array of costs.
function createHeap(cost) {
  const items = [];
  const less = (a, b) => cost[a] < cost[b];
  return {
    get size() { return items.length; },
    push(value) {
      items.push(value);
      let i = items.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (!less(items[i], items[parent])) break;
        [items[i], items[parent]] = [items[parent], items[i]];
        i = parent;
      }
    },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length) {
        items[0] = last;
        let i = 0;
        for (;;) {
          const left = 2 * i + 1, right = left + 1;
          let smallest = i;
          if (left < items.length && less(items[left], items[smallest])) smallest = left;
          if (right < items.length && less(items[right], items[smallest])) smallest = right;
          if (smallest === i) break;
          [items[i], items[smallest]] = [items[smallest], items[i]];
          i = smallest;
        }
      }
      return top;
    }
  };
}

// walkable / blocked: arrays of polygons, each an array of rings of [lon, lat].
// Returns null when nothing is walkable.
export function createNavGrid({ walkable, blocked = [], cellSize = 0.5, origin = null }) {
  const first = walkable?.[0]?.[0]?.[0];
  if (!first) return null;
  // Metres along and across the walls: the local frame, turned by their direction.
  const base = createLocalFrame(origin || first);
  const angle = dominantAngle(walkable.map((rings) => rings.map((ring) => ring.map(base.toLocal))));
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const frame = {
    origin: base.origin,
    angle,
    toLocal: (point) => { const [x, y] = base.toLocal(point); return [x * cos + y * sin, y * cos - x * sin]; },
    toLngLat: ([u, v]) => base.toLngLat([u * cos - v * sin, u * sin + v * cos])
  };
  const toLocalPolygon = (rings) => rings.map((ring) => ring.map(frame.toLocal));
  const areas = walkable.map(toLocalPolygon);
  const holes = blocked.map(toLocalPolygon);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rings of areas) for (const [x, y] of rings[0]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!(maxX > minX && maxY > minY)) return null;
  let size = cellSize;
  while (Math.ceil((maxX - minX) / size) * Math.ceil((maxY - minY) / size) > MAX_CELLS) size *= 1.5;
  const cols = Math.max(1, Math.ceil((maxX - minX) / size));
  const rows = Math.max(1, Math.ceil((maxY - minY) / size));
  const shape = { minX, minY, cols, rows, size };
  const walk = new Uint8Array(cols * rows);
  areas.forEach((rings) => fillPolygon(rings, walk, 1, shape));
  holes.forEach((rings) => fillPolygon(rings, walk, 0, shape));
  let count = 0;
  for (let i = 0; i < walk.length; i += 1) count += walk[i];
  if (!count) return null;

  // Distance to the nearest wall in cells (1 = beside a wall), capped at 3.
  const clearance = new Uint8Array(cols * rows);
  const free = (col, row) => col >= 0 && row >= 0 && col < cols && row < rows && walk[row * cols + col] === 1;
  for (let pass = 1; pass <= 3; pass += 1) {
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      if (!walk[index] || clearance[index]) continue;
      if (pass === 3) { clearance[index] = 3; continue; }
      const edge = (c, r) => !free(c, r) || (pass > 1 && clearance[r * cols + c] === pass - 1);
      if (edge(col - 1, row) || edge(col + 1, row) || edge(col, row - 1) || edge(col, row + 1)) clearance[index] = pass;
    }
  }
  const costOf = (index) => CLEARANCE_COST[clearance[index]] || 1;

  const centre = (index) => [minX + (index % cols + 0.5) * size, minY + (Math.floor(index / cols) + 0.5) * size];
  const cellAt = ([x, y]) => {
    const col = Math.floor((x - minX) / size), row = Math.floor((y - minY) / size);
    return col >= 0 && row >= 0 && col < cols && row < rows ? row * cols + col : -1;
  };

  // The walkable cell nearest a point, within maxM metres: { cell, distanceM } or null.
  function nearestCell(lngLat, maxM = 6) {
    const local = frame.toLocal(lngLat);
    const here = cellAt(local);
    if (here >= 0 && walk[here]) return { cell: here, distanceM: 0 };
    const reach = Math.ceil(maxM / size);
    const col0 = Math.floor((local[0] - minX) / size), row0 = Math.floor((local[1] - minY) / size);
    let best = null;
    for (let row = Math.max(0, row0 - reach); row <= Math.min(rows - 1, row0 + reach); row += 1) {
      for (let col = Math.max(0, col0 - reach); col <= Math.min(cols - 1, col0 + reach); col += 1) {
        const index = row * cols + col;
        if (!walk[index]) continue;
        const d = distance(local, centre(index));
        if (d <= maxM && (!best || d < best.distanceM)) best = { cell: index, distanceM: d };
      }
    }
    return best;
  }

  // Where a room meets the walkable area: the walkable cell nearest the room's
  // outline (within maxM), and among equally near ones the cell nearest `towards`
  // (the room's label point). { cell, distanceM } or null.
  function nearestCellToPolygon(rings, towards, maxM = 2.5) {
    const local = rings.map((ring) => ring.map(frame.toLocal));
    const target = towards ? frame.toLocal(towards) : null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of local[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const colFrom = Math.max(0, Math.floor((x0 - maxM - minX) / size)), colTo = Math.min(cols - 1, Math.floor((x1 + maxM - minX) / size));
    const rowFrom = Math.max(0, Math.floor((y0 - maxM - minY) / size)), rowTo = Math.min(rows - 1, Math.floor((y1 + maxM - minY) / size));
    let best = null;
    for (let row = rowFrom; row <= rowTo; row += 1) {
      for (let col = colFrom; col <= colTo; col += 1) {
        const index = row * cols + col;
        if (!walk[index]) continue;
        const point = centre(index);
        const d = pointToRings(point, local);
        if (d > maxM) continue;
        // Cells within one cell of the nearest count as equally near.
        const rank = Math.round(d / size);
        const tie = target ? distance(point, target) : 0;
        if (!best || rank < best.rank || (rank === best.rank && tie < best.tie)) best = { cell: index, distanceM: d, rank, tie };
      }
    }
    return best ? { cell: best.cell, distanceM: best.distanceM } : null;
  }

  // Cost (metres, weighted by wall clearance, plus the turns) from one cell to
  // every reachable cell. A state is a cell and the direction it was entered in
  // (cell * 4 + direction), so that turns can be counted. Kept for the last few sources.
  const fields = new Map();
  function fieldFrom(source) {
    if (fields.has(source)) return fields.get(source);
    const cost = new Float32Array(cols * rows * 4).fill(Infinity);
    const previous = new Int32Array(cols * rows * 4).fill(-1);
    const done = new Uint8Array(cols * rows * 4);
    const heap = createHeap(cost);
    for (let d = 0; d < 4; d += 1) { cost[source * 4 + d] = 0; heap.push(source * 4 + d); }
    while (heap.size) {
      const current = heap.pop();
      if (done[current]) continue;
      done[current] = 1;
      const cell = current >> 2, heading = current & 3;
      const col = cell % cols, row = (cell - col) / cols;
      for (let d = 0; d < 4; d += 1) {
        const c = col + STEPS[d][0], r = row + STEPS[d][1];
        if (!free(c, r)) continue;
        const next = (r * cols + c) * 4 + d;
        if (done[next]) continue;
        const step = size * (costOf(cell) + costOf(r * cols + c)) / 2 + (d === heading || cell === source ? 0 : TURN_COST_M);
        if (cost[current] + step < cost[next]) {
          cost[next] = cost[current] + step;
          previous[next] = current;
          heap.push(next);
        }
      }
    }
    const field = { cost, previous };
    fields.set(source, field);
    if (fields.size > 12) fields.delete(fields.keys().next().value);
    return field;
  }

  // The state a cell is best reached in from the field's source, or -1.
  function bestState({ cost }, cell) {
    let best = -1;
    for (let d = 0; d < 4; d += 1) if (Number.isFinite(cost[cell * 4 + d]) && (best < 0 || cost[cell * 4 + d] < cost[best])) best = cell * 4 + d;
    return best;
  }

  // Shortest walk between two cells: { coordinates: [[lon, lat], ...], distanceM }
  // or null when they are not connected. The line is the corners of the walk.
  // `start` / `end` ([lon, lat]) are the places themselves, beside those cells
  // (a door, a lift): the line starts and ends at them.
  function path(from, to, { start = null, end = null } = {}) {
    if (from < 0 || to < 0 || !walk[from] || !walk[to]) return null;
    const field = fieldFrom(from);
    const reached = bestState(field, to);
    if (reached < 0) return null;
    const states = [];
    for (let state = reached; state !== -1; state = field.previous[state]) states.push(state);
    states.reverse();
    let points = [centre(states[0] >> 2)];
    for (let k = 2; k < states.length; k += 1) {
      if ((states[k] & 3) !== (states[k - 1] & 3)) points.push(centre(states[k - 1] >> 2));
    }
    if (states.length > 1) points.push(centre(to));
    if (start) { points.reverse(); attach(points, frame.toLocal(start)); points.reverse(); }
    if (end) attach(points, frame.toLocal(end));
    points = points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > 0.01);
    return { coordinates: points.map(frame.toLngLat), distanceM: polylineLength(points) };
  }

  return {
    frame,
    cols,
    rows,
    cellSize: size,
    walkableCells: count,
    isWalkable: (cell) => cell >= 0 && walk[cell] === 1,
    cellOf: (lngLat) => cellAt(frame.toLocal(lngLat)),
    cellCentre: (cell) => frame.toLngLat(centre(cell)),
    nearestCell,
    nearestCellToPolygon,
    // Weighted walking cost in metres between two cells (Infinity when unconnected).
    cost(from, to) {
      if (from < 0 || to < 0 || !walk[from] || !walk[to]) return Infinity;
      const field = fieldFrom(from);
      const state = bestState(field, to);
      return state < 0 ? Infinity : field.cost[state];
    },
    path
  };
}
