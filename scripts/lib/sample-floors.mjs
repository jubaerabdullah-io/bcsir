// Template floor plans for a building, generated from its footprint.
//
// A new building has no floor drawings yet. This module lays out a plain,
// believable floor inside the footprint and returns it in the files the map reads
// per floor: level, corridor, shops (the rooms), walls, doors, furniture and pois.
//
// As in a real building, every floor shares the core: the corridor along the
// building, the lift lobby with the lift and a stair, a second stair at one end and
// the washrooms, stacked above each other. Around that core each floor is divided
// in its own way (SAMPLE_THEMES floors): one side of the corridor as single
// offices, the other as a hall; small rooms here, pairs of rooms there; a waiting
// lounge open to the corridor on some floors. The first floor has the entrance. The
// rooms are furnished according to their use (desks, meeting tables, shelves, ...).
//
// The result is a STARTING POINT to open in QGIS and replace with the surveyed
// drawing: it is correctly placed on the map and has the right attributes, but the
// rooms are invented. building.json marks it "sample": true, and the map says so.
//
// Pure module (no files written here), used by scripts/make-sample-floors.mjs.
import { footprintFront, orientedFootprint } from "../../src/buildings/building-footprint.js";
import { labelAnchor, pointInRings } from "../../src/utils/geo-utils.js";

const CRS84 = { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } };
const round = (value) => Math.round(value * 1e8) / 1e8;
const collection = (name, features) => ({ type: "FeatureCollection", name, crs: CRS84, features });
const feature = (properties, geometry) => ({ type: "Feature", properties, geometry });

const WALL = { outer: 0.22, corridor: 0.12, partition: 0.1 }; // thickness in metres
const DOOR = 1.0; // width of a room's door
const DOOR_INSET = 1.6; // from a partition to the middle of a door beside it
const OPENING = 1.8; // width of the entrance
const MIN_ROOM = 3.0; // the narrowest room a slot is split into
const HALL_SLOTS = 3; // the most slots one hall takes

// How a run of `n` neighbouring slots on one side of the corridor is divided:
// the widths of its rooms, in slots.
export const ROW_PATTERNS = {
  rooms: (n) => Array(n).fill(1),
  split: (n) => Array(2 * n).fill(0.5),
  pairs: (n) => [...Array(Math.floor(n / 2)).fill(2), ...(n % 2 ? [1] : [])],
  hall: (n) => (n <= HALL_SLOTS ? [n] : [HALL_SLOTS, ...ROW_PATTERNS.hall(n - HALL_SLOTS)]),
  mixed: (n) => (n === 1 ? [0.5, 0.5] : [0.5, 0.5, ...Array(Math.max(0, n - 3)).fill(1), n >= 3 ? 2 : 1]),
  suite: (n) => (n === 1 ? [1] : [2, ...(n >= 3 ? [0.5, 0.5] : []), ...Array(Math.max(0, n - 3)).fill(1)])
};

// Room names and how each floor is divided, per kind of building. `floors`: the
// first floor, the floors between (repeated as needed) and the top floor. For each:
// the pattern of the side opposite the entrance (`back`) and of the entrance side
// (`front`), whether a waiting lounge opens to the corridor (`lounge`), the names
// of the largest rooms (`large`, largest first) and of the others (`named`, nearest
// the entrance on the first floor, else nearest the lift). Entries are
// [name, class, furniture layout (default: by class)]. Rooms left over are
// numbered ("Office 204").
export const SAMPLE_THEMES = {
  office: {
    room: ["Office", "office"],
    floors: [
      { front: "rooms", back: "pairs", large: [["Canteen", "food"]], named: [["Reception", "reception"], ["Prayer Room", "prayer"], ["Records Room", "store"], ["Medical Room", "first-aid"], ["Security Office", "office"]] },
      { front: "hall", back: "split", large: [["Administration Section", "office", "open-office"]], named: [["Deputy Secretary (Admin)", "office"], ["Assistant Secretary", "office"], ["Section Officer", "office"], ["Dispatch Section", "store"], ["Meeting Room", "meeting"]] },
      { front: "split", back: "rooms", lounge: true, named: [["Accounts Officer", "office"], ["Cash Section", "office"], ["Audit Cell", "office"], ["Budget Section", "office"], ["Pension Cell", "office"], ["File Room", "store"], ["Finance Director", "office", "executive"]] },
      { front: "suite", back: "hall", large: [["Library", "hall", "library"], ["Reading Room", "classroom", "library"]], named: [["Librarian", "office"], ["Archive", "store"], ["Photocopy Room", "office"]] },
      { front: "pairs", back: "mixed", large: [["Training Room", "classroom", "training"], ["ICT Cell", "office", "open-office"]], named: [["Server Room", "store", "server"], ["Planning Officer", "office"], ["Project Monitoring", "office"]] },
      { front: "mixed", back: "hall", lounge: true, large: [["Board Room", "meeting", "boardroom"]], named: [["Chairman's Office", "office", "executive"], ["PS to Chairman", "office"], ["Member (Administration)", "office", "executive"], ["Member (Science)", "office", "executive"], ["Secretary", "office", "executive"], ["Conference Room", "meeting"]] }
    ]
  },
  factory: {
    room: ["Production Hall", "production"],
    floors: [
      { front: "rooms", back: "rooms", named: [["Reception", "reception"], ["Medical Room", "first-aid"], ["Canteen", "food"], ["Prayer Room", "prayer"]] },
      { front: "hall", back: "pairs" },
      { front: "pairs", back: "hall", named: [["Quality Control", "lab"]] },
      { front: "rooms", back: "split", named: [["Sample Room", "office"], ["Meeting Room", "meeting"]] }
    ]
  },
  warehouse: {
    room: ["Storage Bay", "storage"],
    floors: [
      { front: "hall", back: "rooms", named: [["Loading Bay", "loading"], ["Receiving Office", "office"]] },
      { front: "hall", back: "hall" },
      { front: "pairs", back: "pairs", named: [["Records Room", "store"]] }
    ]
  },
  lab: {
    room: ["Laboratory", "lab"],
    floors: [
      { front: "rooms", back: "rooms", named: [["Reception", "reception"], ["Sample Receiving", "office"], ["Prayer Room", "prayer"]] },
      { front: "pairs", back: "split", named: [["Instrument Room", "lab"], ["Scientist's Office", "office"]] },
      { front: "split", back: "pairs", named: [["Chemical Store", "store"], ["Glassware Washing", "lab"]] },
      { front: "hall", back: "rooms", large: [["Seminar Room", "meeting", "training"]] }
    ]
  }
};
const CORE_ROOMS = [["Store", "store"], ["Electrical Room", "store"], ["Janitor's Room", "store"]]; // behind the lift lobby, by floor

// The program of floor `index` of `count` (first, between, top).
function floorProgram(theme, index, count) {
  const floors = theme.floors;
  if (index === 0) return floors[0];
  if (index === count - 1 && floors.length > 1) return floors.at(-1);
  const between = floors.slice(1, -1);
  return between.length ? between[(index - 1) % between.length] : floors[0];
}

// ---- Furniture ----------------------------------------------------------------------
// Furniture layouts by use. Each lays out a room `W` wide and `D` deep in room
// space: u across the room, v from its door wall (the corridor) inwards. `add`
// leaves out a piece that would stand in a doorway or outside the room.
const LAYOUTS = {
  office({ W, D, add }) {
    const sets = W >= 7.2 ? 2 : 1;
    const v = Math.max(2.3, Math.min(D - 1.7, D * 0.58));
    for (let k = 0; k < sets; k += 1) {
      const u = (W * (k + 0.5)) / sets;
      add("desk", u - 0.75, v - 0.38, u + 0.75, v + 0.38);
      add("chair", u - 0.3, v + 0.52, u + 0.3, v + 1.08, { height_m: 1.0 });
      add("chair", u - 0.72, v - 1.0, u - 0.27, v - 0.55);
      add("chair", u + 0.27, v - 1.0, u + 0.72, v - 0.55);
    }
    add("cabinet", 0.2, D - 0.62, Math.min(1.9, W * 0.4), D - 0.2);
    add("plant", W - 0.72, D - 0.72, W - 0.25, D - 0.25);
  },
  executive({ W, D, add }) {
    const u = W >= 6 ? W * 0.36 : W / 2, v = Math.max(2.5, Math.min(D - 1.8, D * 0.6));
    add("desk", u - 1.0, v - 0.45, u + 1.0, v + 0.45, { color: "#8b5e3c" });
    add("chair", u - 0.33, v + 0.6, u + 0.33, v + 1.2, { height_m: 1.15 });
    for (const du of [-0.6, 0.6]) add("chair", u + du - 0.25, v - 1.15, u + du + 0.25, v - 0.65);
    if (W >= 6) {
      add("sofa", W - 1.05, D * 0.22, W - 0.2, D * 0.22 + 2.1);
      add("table", W - 2.05, D * 0.22 + 0.55, W - 1.35, D * 0.22 + 1.55, { height_m: 0.42 });
      add("armchair", W - 3.0, D * 0.22 + 0.6, W - 2.3, D * 0.22 + 1.5);
    }
    add("cabinet", 0.2, D - 0.6, Math.min(2.4, W * 0.45), D - 0.2);
    add("plant", W - 0.7, D - 0.7, W - 0.25, D - 0.25);
  },
  "open-office"({ W, D, add }) {
    // Clusters of four workstations, back to back.
    for (let u = 0.9; u + 2.8 <= W - 0.5; u += 3.6) {
      for (let v = 1.9; v + 1.4 <= D - 0.8; v += 3.2) {
        for (const [du, dv] of [[0, 0], [1.4, 0], [0, 0.7], [1.4, 0.7]]) add("desk", u + du, v + dv, u + du + 1.38, v + dv + 0.68);
        for (const du of [0.48, 1.88]) { add("chair", u + du, v - 0.56, u + du + 0.44, v - 0.12); add("chair", u + du, v + 1.52, u + du + 0.44, v + 1.96); }
      }
    }
    add("cabinet", 0.2, D - 0.55, 2.0, D - 0.15);
    add("plant", W - 0.7, D - 0.7, W - 0.25, D - 0.25);
  },
  meeting({ W, D, add }, { board = false } = {}) {
    // A table along the longer side of the room, chairs all round.
    const along = W >= D;
    const length = Math.max(1.6, Math.min((along ? W : D) - 2.6, board ? 9 : 6));
    const width = board ? 1.5 : 1.15;
    const cu = W / 2, cv = Math.max(1.6 + (along ? width / 2 : length / 2), Math.min(D - 1.3 - (along ? width / 2 : length / 2), D * 0.56));
    const [hu, hv] = along ? [length / 2, width / 2] : [width / 2, length / 2];
    add("table", cu - hu, cv - hv, cu + hu, cv + hv, { color: board ? "#7b5235" : "#d9c3a0" });
    const seats = Math.max(1, Math.floor(length / 0.85));
    for (let i = 0; i < seats; i += 1) {
      const t = -length / 2 + (length / seats) * (i + 0.5);
      if (along) { add("chair", cu + t - 0.22, cv - hv - 0.58, cu + t + 0.22, cv - hv - 0.14); add("chair", cu + t - 0.22, cv + hv + 0.14, cu + t + 0.22, cv + hv + 0.58); }
      else { add("chair", cu - hu - 0.58, cv + t - 0.22, cu - hu - 0.14, cv + t + 0.22); add("chair", cu + hu + 0.14, cv + t - 0.22, cu + hu + 0.58, cv + t + 0.22); }
    }
    if (board) {
      if (along) for (const end of [-1, 1]) add("chair", cu + end * (hu + 0.36) - 0.24, cv - 0.24, cu + end * (hu + 0.36) + 0.24, cv + 0.24, { height_m: 1.05 });
      add("cabinet", 0.3, D - 0.55, Math.min(3.0, W * 0.3), D - 0.15);
    }
    add("board", W / 2 - 1.0, D - 0.2, W / 2 + 1.0, D - 0.12, { base_m: 0.8, height_m: 1.1 });
    add("plant", 0.25, D - 0.7, 0.7, D - 0.25);
  },
  boardroom(room, ) { LAYOUTS.meeting(room, { board: true }); },
  reception({ W, D, add }) {
    const u = W / 2, v = Math.min(2.6, D * 0.42);
    add("counter", u - 1.4, v, u + 1.4, v + 0.6);
    add("counter", u + 0.8, v + 0.6, u + 1.4, v + 1.5);
    add("chair", u - 0.3, v + 0.9, u + 0.3, v + 1.4, { height_m: 1.0 });
    add("sofa", 0.2, D * 0.45, 0.95, D * 0.45 + 2.0);
    add("cabinet", W - 1.9, D - 0.55, W - 0.25, D - 0.15);
    add("plant", 0.25, D - 0.7, 0.7, D - 0.25);
  },
  food({ W, D, add }) {
    add("counter", 0.6, D - 0.8, W - 0.6, D - 0.2);
    for (let u = 1.3; u + 0.9 <= W - 1.0; u += 2.3) for (let v = 1.9; v + 0.9 <= D - 1.8; v += 2.1) {
      add("table", u, v, u + 0.9, v + 0.9);
      add("chair", u + 0.25, v - 0.5, u + 0.65, v - 0.1); add("chair", u + 0.25, v + 1.0, u + 0.65, v + 1.4);
      add("chair", u - 0.5, v + 0.25, u - 0.1, v + 0.65); add("chair", u + 1.0, v + 0.25, u + 1.4, v + 0.65);
    }
  },
  prayer({ W, D, add }) {
    for (let v = 1.7; v + 1.0 <= D - 0.3; v += 1.25) add("carpet", 0.5, v, W - 0.5, v + 1.0);
    add("shelf", W - 0.6, 0.25, W - 0.2, 1.1, { height_m: 0.9 });
  },
  toilet({ W, D, add }) {
    add("basin", 0.2, 1.6, 0.75, Math.max(2.4, D * 0.48));
    // Cubicles along the outer wall: their partitions.
    const cubicles = Math.max(1, Math.floor((W - 1.2) / 1.25));
    for (let i = 0; i <= cubicles; i += 1) {
      const u = W - 0.2 - i * 1.25;
      if (u < 1.0) break;
      add("cubicle", u - 0.05, D - 1.7, u, D - 0.15);
    }
  },
  store({ W, D, add }) {
    for (let v = 1.7; v + 0.5 <= D - 0.25; v += 1.6) {
      add("shelf", 0.3, v, W / 2 - 0.5, v + 0.5);
      add("shelf", W / 2 + 0.5, v, W - 0.3, v + 0.5);
    }
  },
  library({ W, D, add }) {
    add("shelf", 0.3, D - 0.55, W - 0.3, D - 0.15);
    add("shelf", 0.15, 1.6, 0.55, D - 0.8);
    add("shelf", W - 0.55, 1.6, W - 0.15, D - 0.8);
    for (let u = 1.4; u + 1.8 <= W - 1.2; u += 2.9) for (let v = 2.2; v + 0.9 <= D - 1.6; v += 2.4) {
      add("table", u, v, u + 1.8, v + 0.9);
      for (const du of [0.25, 1.1]) { add("chair", u + du, v - 0.52, u + du + 0.44, v - 0.1); add("chair", u + du, v + 1.0, u + du + 0.44, v + 1.42); }
    }
  },
  training({ W, D, add }) {
    add("board", W / 2 - 1.5, D - 0.2, W / 2 + 1.5, D - 0.12, { base_m: 0.8, height_m: 1.2 });
    add("podium", W / 2 + 1.8, D - 1.5, W / 2 + 2.4, D - 0.9);
    for (let v = 1.9; v + 0.5 <= D - 2.2; v += 1.45) {
      for (const [u0, u1] of [[0.8, W / 2 - 0.45], [W / 2 + 0.45, W - 0.8]]) {
        if (u1 - u0 < 1.0) continue;
        add("desk", u0, v + 0.5, u1, v + 1.0, { height_m: 0.74 });
        for (let u = u0 + 0.2; u + 0.42 <= u1; u += 0.8) add("chair", u, v, u + 0.42, v + 0.42);
      }
    }
  },
  server({ W, D, add }) {
    for (let v = 1.8; v + 0.65 <= D - 0.6; v += 1.9) add("rack", 0.8, v, W - 0.8, v + 0.65);
    add("cabinet", 0.2, D - 0.5, 1.4, D - 0.15, { color: "#cbd5e1", height_m: 1.9 });
  },
  lab({ W, D, add }) {
    add("bench", 0.15, 1.5, 0.9, D - 0.2);
    add("bench", W - 0.9, 1.5, W - 0.15, D - 0.2);
    add("bench", 0.9, D - 0.9, W - 0.9, D - 0.15);
    if (W >= 5.5) add("bench", W / 2 - 0.6, 2.4, W / 2 + 0.6, D - 1.9);
  },
  "first-aid"({ W, D, add }) {
    add("bed", W - 1.15, D - 2.25, W - 0.2, D - 0.2);
    add("desk", 0.3, D * 0.45, 1.7, D * 0.45 + 0.7);
    add("chair", 0.75, D * 0.45 + 0.85, 1.2, D * 0.45 + 1.3);
    add("cabinet", 0.2, D - 0.55, 1.6, D - 0.15);
  },
  lounge({ W, D, add }) {
    // Sofas facing the corridor along the outer wall, a low table, plants.
    add("sofa", 0.9, D - 1.0, W - 0.9, D - 0.2);
    add("table", W / 2 - 0.8, D - 2.1, W / 2 + 0.8, D - 1.4, { height_m: 0.42 });
    add("plant", 0.2, D - 0.7, 0.65, D - 0.25);
    add("plant", W - 0.65, D - 0.7, W - 0.2, D - 0.25);
  },
  lobby({ W, D, add }) {
    add("plant", 0.25, D - 0.7, 0.7, D - 0.25);
    add("plant", W - 0.7, D - 0.7, W - 0.25, D - 0.25);
    add("sofa", W - 0.95, 1.5, W - 0.2, Math.min(D - 1.0, 3.5));
  }
};
const LAYOUT_BY_CLASS = { office: "office", meeting: "meeting", reception: "reception", food: "food", prayer: "prayer", store: "store", storage: "store", loading: "store", toilet: "toilet", lab: "lab", production: "lab", classroom: "training", hall: "library", "first-aid": "first-aid" };

function outerRings(geometry) {
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.reduce((best, rings) => (!best || rings[0].length > best[0].length ? rings : best), null);
}

// The largest rectangle (along the footprint's long axis, centred on its label
// point) that fits inside the footprint, less a wall margin. For a rectangular
// building this is the footprint itself. Returns { centre, a, b }: half sizes in
// metres along the long and the short axis.
function innerRectangle(building, footprint, margin = 0.25) {
  const { frame, u, v } = footprint;
  const rings = outerRings(building.geometry);
  const dot = (p, axis) => p[0] * axis[0] + p[1] * axis[1];
  const anchor = frame.toLocal(labelAnchor(building));
  const corners = footprint.corners.map(frame.toLocal);
  const us = corners.map((corner) => dot(corner, u));
  const vs = corners.map((corner) => dot(corner, v));
  const fits = (centre, a, b) => {
    const steps = 24;
    for (let i = 0; i <= steps; i += 1) {
      const t = -1 + (2 * i) / steps;
      for (const [x, y] of [[t * a, -b], [t * a, b], [-a, t * b], [a, t * b]]) {
        const local = [centre[0] + u[0] * x + v[0] * y, centre[1] + u[1] * x + v[1] * y];
        if (!pointInRings(frame.toLngLat(local), rings)) return false;
      }
    }
    return true;
  };
  // The footprint rectangle itself when the building fills it; otherwise shrink
  // around the label point (always inside, also for L and U shapes).
  const centred = footprint.centerLocal;
  for (const centre of [centred, anchor]) {
    const cu = dot(centre, u), cv = dot(centre, v);
    const a0 = Math.min(cu - Math.min(...us), Math.max(...us) - cu);
    const b0 = Math.min(cv - Math.min(...vs), Math.max(...vs) - cv);
    for (let scale = 1; scale > 0.2; scale -= 0.02) {
      const a = a0 * scale - margin, b = b0 * scale - margin;
      if (a > 3 && b > 2 && fits(centre, a, b)) return { centre, a, b };
      if (centre === centred && scale < 0.9) break; // not a rectangle: use the label point
    }
  }
  return null;
}

// Pieces of [from, to] left after removing the gaps ([start, end] each).
function withoutGaps(from, to, gaps) {
  const pieces = [];
  let cursor = from;
  for (const [start, end] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (start > cursor + 0.05) pieces.push([cursor, Math.min(start, to)]);
    cursor = Math.max(cursor, end);
  }
  if (to > cursor + 0.05) pieces.push([cursor, to]);
  return pieces;
}

// Runs of neighbouring slots (indices 0 .. slots-1) left after taking out `taken`.
function freeRuns(slots, taken) {
  const runs = [];
  let run = [];
  for (let i = 0; i < slots; i += 1) {
    if (taken.has(i)) { if (run.length) runs.push(run); run = []; } else run.push(i);
  }
  if (run.length) runs.push(run);
  return runs;
}

// building: a GeoJSON Polygon / MultiPolygon feature with `id` (and optionally
// entrance_coords [lon, lat]). Returns { files: { "building.json": {...},
// "L01/level.geojson": {...}, ... }, summary }, or throws when the footprint is too small.
export function sampleFloors(building, { floors = 3, theme = "office", name = "" } = {}) {
  const footprint = orientedFootprint(building);
  if (!footprint) throw new Error("The building has no polygon footprint.");
  const inner = innerRectangle(building, footprint);
  if (!inner) throw new Error("The footprint is too small or too irregular for a template floor (it needs about 8 x 5 m of clear rectangle).");
  const names = SAMPLE_THEMES[theme] || SAMPLE_THEMES.office;
  const { frame, u, v } = footprint;
  const { centre, a, b } = inner;

  // Entrance: on the first floor, in the rectangle side nearest the recorded
  // entrance (the front long side when none is recorded). `flip` turns the layout
  // so that this side is y = -b.
  const entrance = Array.isArray(building.properties?.entrance_coords) ? building.properties.entrance_coords.map(Number) : null;
  let ex = 0, ey = -b;
  if (entrance?.length >= 2 && entrance.every(Number.isFinite)) {
    const local = frame.toLocal(entrance);
    ex = (local[0] - centre[0]) * u[0] + (local[1] - centre[1]) * u[1];
    ey = (local[0] - centre[0]) * v[0] + (local[1] - centre[1]) * v[1];
  } else if (footprintFront(footprint).side === "+v") ey = b;
  const flip = ey > 0 ? -1 : 1;
  ey *= flip;
  const atEnd = a - Math.abs(ex) < b - Math.abs(ey) && Math.abs(ex) > a * 0.6; // nearer a short end than the front
  ex = Math.max(-a + 1.5, Math.min(a - 1.5, ex));

  const P = (x, y) => frame.toLngLat([centre[0] + u[0] * x + v[0] * y * flip, centre[1] + u[1] * x + v[1] * y * flip]).map(round);
  const rectangle = (x0, y0, x1, y1) => ({ type: "Polygon", coordinates: [[P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0)]] });
  const line = (...points) => ({ type: "LineString", coordinates: points.map(([x, y]) => P(x, y)) });
  const point = (x, y) => ({ type: "Point", coordinates: P(x, y) });

  // The core, the same on every floor: a corridor along the building, rooms on both
  // sides when it is deep enough, the lift lobby off the corridor, the washrooms.
  const singleLoaded = 2 * b < 8.5;
  const half = Math.min(b > 10 ? 1.5 : 1.2, b * 0.35); // corridor half width
  const y0 = singleLoaded ? -b : -half; // corridor from y0 ...
  const y1 = singleLoaded ? -b + 2 * half : half; // ... to y1
  const backDepth = b - y1;
  const frontDepth = singleLoaded ? 0 : y0 + b;
  const slotWidth = Math.max(4.5, Math.min(12, backDepth * 0.8));
  const slots = Math.max(2, Math.round((2 * a) / slotWidth));
  const width = (2 * a) / slots;
  const slotStart = (i) => -a + i * width;
  const core = Math.floor(slots / 2); // back slot of the lift lobby
  const toilets = slots >= 3 && core !== slots - 1 ? slots - 1 : -1; // back slot of the washrooms
  const alcove = Math.min(3.4, backDepth * 0.5); // depth of the lift lobby
  const lobby = !atEnd && !singleLoaded ? Math.max(0, Math.min(slots - 1, Math.floor((ex + a) / width))) : -1; // front slot of the entrance lobby (first floor)
  const farStairX = atEnd && ex < 0 ? a - 1.6 : -a + 1.6; // second stair: the end away from an end entrance
  const coreX = slotStart(core);
  const liftPoint = [coreX + width * 0.3, y1 + alcove * 0.6];

  const files = { "building.json": { building_id: building.properties?.id ?? null, sample: true, note: "Template floors generated by `npm run floors:sample`. The rooms are invented: replace these files with the surveyed floor plans." } };
  if (name) files["building.json"].name = name;
  let roomTotal = 0;

  for (let index = 0; index < floors; index += 1) {
    const number = index + 1;
    const folder = `L${String(number).padStart(2, "0")}`;
    const first = index === 0;
    const program = floorProgram(names, index, floors);
    const mirrored = index % 2 === 1; // every other floor is divided from the other end
    let serial = 0;
    const rooms = [], walls = [], doors = [], furniture = [], pois = [], corridors = [];
    const wall = (kind, geometry) => walls.push(feature({ id: walls.length + 1, kind, thickness_m: WALL[kind] }, geometry));

    // ---- Dividing the two sides of the corridor --------------------------------------
    // A room: { x0, x1, near (y of its corridor wall), far (y of the outer wall), side }.
    const sideRooms = (side, taken, pattern) => {
      const list = [];
      for (const run of freeRuns(slots, taken)) {
        let widths = (ROW_PATTERNS[pattern] || ROW_PATTERNS.rooms)(run.length);
        // Half slots narrower than MIN_ROOM stay whole slots (halves come in pairs).
        if (width / 2 < MIN_ROOM) widths = widths.flatMap((w, i) => (w !== 0.5 ? [w] : widths.slice(0, i).filter((item) => item === 0.5).length % 2 ? [] : [1]));
        if (mirrored) widths = [...widths].reverse();
        let x = slotStart(run[0]);
        for (const w of widths) {
          const x1 = x + w * width;
          list.push(side === "back" ? { x0: x, x1, near: y1, far: b, side, slots: w } : { x0: x, x1, near: y0, far: -b, side, slots: w });
          x = x1;
        }
      }
      return list;
    };
    const backTaken = new Set([core, ...(toilets >= 0 ? [toilets] : [])]);
    const backRooms = sideRooms("back", backTaken, program.back);
    // The front: the entrance lobby (first floor) and the lounge (some floors) are open to the corridor.
    const frontOpen = new Set(first && lobby >= 0 ? [lobby] : []);
    if (program.lounge && !singleLoaded) {
      const candidates = [...Array(slots).keys()].filter((i) => !frontOpen.has(i)).sort((p, q) => Math.abs(slotStart(p) + width / 2 - (coreX + width / 2)) - Math.abs(slotStart(q) + width / 2 - (coreX + width / 2)));
      if (candidates.length > 1) frontOpen.add(candidates[0]);
    }
    const lounge = program.lounge ? [...frontOpen].find((i) => i !== (first ? lobby : -1)) ?? -1 : -1;
    const frontRooms = singleLoaded ? [] : sideRooms("front", frontOpen, program.front);

    // ---- Names ------------------------------------------------------------------------
    const anchorX = first ? ex : liftPoint[0];
    const distance = (room) => Math.abs((room.x0 + room.x1) / 2 - anchorX) + (room.side === (first ? "front" : "back") ? 0 : 3);
    const all = [...backRooms, ...frontRooms];
    const large = [...(program.large || [])];
    const named = [...(program.named || [])];
    for (const room of [...all].filter((item) => item.slots >= 1.5).sort((p, q) => q.slots - p.slots || distance(p) - distance(q))) room.entry = large.shift();
    for (const room of [...all].filter((item) => !item.entry).sort((p, q) => distance(p) - distance(q))) room.entry = named.shift();

    // ---- Rooms, their doors and furniture --------------------------------------------
    const doorGaps = { back: [], front: [] };
    const addDoor = (room, x) => {
      doorGaps[room.side].push([x - DOOR / 2, x + DOOR / 2]);
      doors.push(feature({ id: `${folder}-D${String(doors.length + 1).padStart(2, "0")}`, room: room.id, thickness_m: WALL.corridor }, line([x - DOOR / 2, room.near], [x + DOOR / 2, room.near])));
      return x;
    };
    // doorXs: doors in the corridor wall; outerDoorXs: openings in the outer wall (the entrance).
    const furnish = (room, layout, doorXs, outerDoorXs = []) => {
      const s = Math.sign(room.far - room.near);
      const W = room.x1 - room.x0, D = Math.abs(room.far - room.near);
      const doorsU = doorXs.map((x) => x - room.x0), outerU = outerDoorXs.map((x) => x - room.x0);
      const add = (kind, u0, v0, u1, v1, extra = {}) => {
        if (u1 - u0 < 0.04 || v1 - v0 < 0.04 || u0 < 0.12 || u1 > W - 0.12 || v0 < 0.12 || v1 > D - 0.1) return;
        // Doorways stay clear.
        if (doorsU.some((du) => u1 > du - 0.8 && u0 < du + 0.8 && v0 < 1.35)) return;
        if (outerU.some((du) => u1 > du - 1.2 && u0 < du + 1.2 && v1 > D - 1.6)) return;
        const ya = room.near + s * v0, yb = room.near + s * v1;
        furniture.push(feature({ id: `${folder}-F${String(furniture.length + 1).padStart(3, "0")}`, kind, room: room.id ?? null, ...extra }, rectangle(room.x0 + u0, Math.min(ya, yb), room.x0 + u1, Math.max(ya, yb))));
      };
      LAYOUTS[layout]?.({ W, D, add });
    };
    const addRoom = (room, [label, type, layout] = []) => {
      serial += 1;
      const roomNumber = `${number}${String(serial).padStart(2, "0")}`;
      room.id = `${folder}-${String(serial).padStart(2, "0")}`;
      const [fallbackName, fallbackClass] = names.room;
      const roomClass = type || fallbackClass;
      rooms.push(feature({ id: room.id, name: label || `${fallbackName} ${roomNumber}`, class: roomClass, room_number: roomNumber }, rectangle(room.x0, Math.min(room.near, room.far), room.x1, Math.max(room.near, room.far))));
      // Doors: in the middle of a small room; a larger one opens near its end towards
      // the lift (on alternate floors the other end); a hall at both ends.
      const w = room.x1 - room.x0;
      const towardsLift = (room.x0 + room.x1) / 2 < liftPoint[0] ? room.x1 - DOOR_INSET : room.x0 + DOOR_INSET;
      const awayFromLift = towardsLift === room.x1 - DOOR_INSET ? room.x0 + DOOR_INSET : room.x1 - DOOR_INSET;
      const doorXs = w <= 2 * DOOR_INSET + 1.4 ? [(room.x0 + room.x1) / 2] : w >= 12 ? [room.x0 + DOOR_INSET, room.x1 - DOOR_INSET] : [mirrored ? awayFromLift : towardsLift];
      doorXs.forEach((x) => addDoor(room, x));
      const big = room.slots >= 1.5 || w >= 11;
      furnish(room, layout || (big && (roomClass === "office" || roomClass === "room") ? "open-office" : LAYOUT_BY_CLASS[roomClass] || "office"), doorXs);
    };
    [...backRooms, ...frontRooms].forEach((room) => addRoom(room, room.entry));

    // The core slot: the lift lobby, and a room behind it when it is deep enough.
    const coreX1 = slotStart(core + 1);
    const behind = backDepth - alcove > 2.2;
    if (behind) {
      const store = { x0: coreX, x1: coreX1, near: y1 + alcove, far: b, side: "core" };
      serial += 1;
      store.id = `${folder}-${String(serial).padStart(2, "0")}`;
      const [label, type] = CORE_ROOMS[index % CORE_ROOMS.length];
      rooms.push(feature({ id: store.id, name: label, class: type, room_number: `${number}${String(serial).padStart(2, "0")}` }, rectangle(coreX, y1 + alcove, coreX1, b)));
      const middle = (coreX + coreX1) / 2;
      doors.push(feature({ id: `${folder}-D${String(doors.length + 1).padStart(2, "0")}`, room: store.id, thickness_m: WALL.partition }, line([middle - DOOR / 2, y1 + alcove], [middle + DOOR / 2, y1 + alcove])));
      withoutGaps(coreX, coreX1, [[middle - DOOR / 2, middle + DOOR / 2]]).forEach(([s, e]) => wall("partition", line([s, y1 + alcove], [e, y1 + alcove])));
      furnish(store, "store", [middle]);
    } else wall("partition", line([coreX, y1 + alcove], [coreX1, y1 + alcove]));
    // The washrooms, stacked on every floor: gents and ladies when the slot is wide enough.
    if (toilets >= 0) {
      const tx0 = slotStart(toilets), tx1 = slotStart(toilets + 1);
      const parts = width / 2 >= MIN_ROOM ? [[tx0, (tx0 + tx1) / 2, "Gents Washroom"], [(tx0 + tx1) / 2, tx1, "Ladies Washroom"]] : [[tx0, tx1, "Washroom"]];
      for (const [x0, x1, label] of parts) {
        const room = { x0, x1, near: y1, far: b, side: "back", slots: (x1 - x0) / width };
        addRoom(room, [label, "toilet"]);
        backRooms.push(room);
      }
    }

    // ---- Walkable areas: the corridor, the lift lobby, the entrance lobby, the lounge ----
    // The corridor reaches the middle of its walls, so that a door in them is on it.
    corridors.push(feature({ id: 1, name: "Corridor", class: "corridor" }, rectangle(-a, singleLoaded ? y0 : y0 - WALL.corridor / 2, a, y1 + WALL.corridor / 2)));
    corridors.push(feature({ id: 2, name: "Lift lobby", class: "lobby" }, rectangle(coreX, y1, coreX1, y1 + alcove + WALL.partition / 2)));
    if (first && lobby >= 0) {
      corridors.push(feature({ id: 3, name: "Entrance lobby", class: "lobby" }, rectangle(slotStart(lobby), -b, slotStart(lobby + 1), y0)));
      furnish({ x0: slotStart(lobby), x1: slotStart(lobby + 1), near: y0, far: -b }, "lobby", [], [ex]);
    }
    if (lounge >= 0) {
      corridors.push(feature({ id: corridors.length + 1, name: "Waiting lounge", class: "lobby" }, rectangle(slotStart(lounge), -b, slotStart(lounge + 1), y0)));
      furnish({ x0: slotStart(lounge), x1: slotStart(lounge + 1), near: y0, far: -b }, "lounge", []);
    }

    // ---- Walls --------------------------------------------------------------------------
    // Partitions between neighbouring rooms, lobbies and the core, on each side.
    const edges = (side) => {
      const xs = new Set();
      const spans = side === "back"
        ? [...backRooms.map((room) => [room.x0, room.x1]), [coreX, coreX1]]
        : [...frontRooms.map((room) => [room.x0, room.x1]), ...[...frontOpen].map((i) => [slotStart(i), slotStart(i + 1)])];
      for (const [x0, x1] of spans) for (const x of [x0, x1]) if (x > -a + 0.05 && x < a - 0.05) xs.add(Math.round(x * 1000) / 1000);
      return [...xs];
    };
    edges("back").forEach((x) => wall("partition", line([x, y1], [x, b])));
    if (!singleLoaded) edges("front").forEach((x) => wall("partition", line([x, -b], [x, y0])));
    // Corridor walls, open where the doors, the lift lobby and the open front slots are.
    withoutGaps(-a, a, [[coreX, coreX1], ...doorGaps.back]).forEach(([s, e]) => wall("corridor", line([s, y1], [e, y1])));
    if (!singleLoaded) withoutGaps(-a, a, [...[...frontOpen].map((i) => [slotStart(i), slotStart(i + 1)]), ...doorGaps.front]).forEach(([s, e]) => wall("corridor", line([s, y0], [e, y0])));
    // Outer walls, with the entrance opening on the first floor.
    const frontOpening = first && !atEnd ? [[ex - OPENING / 2, ex + OPENING / 2]] : [];
    const endOpening = (side) => (first && atEnd && Math.sign(ex) === side ? [[(y0 + y1) / 2 - OPENING / 2, (y0 + y1) / 2 + OPENING / 2]] : []);
    withoutGaps(-a, a, frontOpening).forEach(([s, e]) => wall("outer", line([s, -b], [e, -b])));
    wall("outer", line([-a, b], [a, b]));
    withoutGaps(-b, b, endOpening(-1)).forEach(([s, e]) => wall("outer", line([-a, s], [-a, e])));
    withoutGaps(-b, b, endOpening(1)).forEach(([s, e]) => wall("outer", line([a, s], [a, e])));

    // ---- Points -------------------------------------------------------------------------
    // The lift and the stairs stand at the same place on every floor, which is how
    // the map knows they are the same lift and the same stairs.
    pois.push(feature({ id: "lift-a", name: "Lift A", class: "lift" }, point(...liftPoint)));
    pois.push(feature({ id: "stair-1", name: "Stair 1", class: "stairs" }, point(coreX + width * 0.7, y1 + alcove * 0.6)));
    pois.push(feature({ id: "stair-2", name: "Stair 2", class: "stairs" }, point(farStairX, (y0 + y1) / 2)));
    const inCorridor = (x) => Math.max(-a + 0.6, Math.min(a - 0.6, x));
    pois.push(feature({ id: "fire-1", name: "Fire Extinguisher", class: "fire" }, point(inCorridor(coreX - 0.5), y1 - 0.3)));
    if (toilets >= 0 && number % 2 === 0) pois.push(feature({ id: "water-1", name: "Drinking Water", class: "water" }, point(inCorridor(slotStart(toilets) - 0.6), y1 - 0.3)));
    if (first) {
      const door = atEnd ? [Math.sign(ex) * a, (y0 + y1) / 2] : [ex, -b];
      pois.push(feature({ id: "entrance", name: "Main Entrance", class: "entrance" }, point(...door)));
      if (lobby >= 0) {
        pois.push(feature({ id: "info", name: "Information Desk", class: "info" }, point(slotStart(lobby) + width * 0.25, y0 - frontDepth * 0.45)));
        pois.push(feature({ id: "first-aid", name: "First Aid", class: "first-aid" }, point(slotStart(lobby) + width * 0.75, y0 - frontDepth * 0.3)));
      }
    }

    files[`${folder}/level.geojson`] = collection("level", [feature({ id: folder, name: `Level ${number}`, short_name: `L${number}` }, building.geometry)]);
    files[`${folder}/corridor.geojson`] = collection("corridor", corridors);
    files[`${folder}/shops.geojson`] = collection("shops", rooms);
    files[`${folder}/walls.geojson`] = collection("walls", walls);
    files[`${folder}/doors.geojson`] = collection("doors", doors);
    files[`${folder}/furniture.geojson`] = collection("furniture", furniture);
    files[`${folder}/pois.geojson`] = collection("pois", pois);
    roomTotal += rooms.length;
  }
  return { files, summary: { floors, rooms: roomTotal, size: [2 * a, 2 * b].map((value) => Math.round(value * 10) / 10), entrance: atEnd ? "end" : "front" } };
}
