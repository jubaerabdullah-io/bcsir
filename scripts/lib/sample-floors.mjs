// Template floor plans for a building, generated from its footprint.
//
// A new building has no floor drawings yet. This module lays out a plain,
// believable floor inside the footprint (a corridor along the building, rooms on
// both sides, a lift lobby with a lift and stairs, a second stair, an entrance on
// the first floor) and returns it in the five files the map reads per floor:
// level, corridor, shops (the rooms), walls and pois. The result is a STARTING
// POINT to open in QGIS and replace with the surveyed drawing: it is correctly
// placed on the map and has the right attributes, but the rooms are invented.
// building.json marks it "sample": true, and the map says so.
//
// Pure module (no files written here), used by scripts/make-sample-floors.mjs.
import { footprintFront, orientedFootprint } from "../../src/buildings/building-footprint.js";
import { labelAnchor, pointInRings } from "../../src/utils/geo-utils.js";

const CRS84 = { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } };
const round = (value) => Math.round(value * 1e8) / 1e8;
const collection = (name, features) => ({ type: "FeatureCollection", name, crs: CRS84, features });
const feature = (properties, geometry) => ({ type: "Feature", properties, geometry });

// Room names and classes per kind of building. `ground` rooms are used first on the
// lowest floor, `top` on the highest; the others are numbered ("Office 204").
export const SAMPLE_THEMES = {
  office: {
    ground: [["Reception", "reception"], ["Canteen", "food"], ["Prayer Room", "prayer"], ["Records Room", "store"]],
    top: [["Conference Room", "meeting"], ["Director's Office", "office"]],
    room: ["Office", "office"]
  },
  factory: {
    ground: [["Reception", "reception"], ["Medical Room", "first-aid"], ["Canteen", "food"], ["Prayer Room", "prayer"]],
    top: [["Sample Room", "office"], ["Meeting Room", "meeting"]],
    room: ["Production Hall", "production"]
  },
  warehouse: {
    ground: [["Loading Bay", "loading"], ["Receiving Office", "office"]],
    top: [["Records Room", "store"]],
    room: ["Storage Bay", "storage"]
  },
  lab: {
    ground: [["Reception", "reception"], ["Sample Receiving", "office"], ["Prayer Room", "prayer"]],
    top: [["Seminar Room", "meeting"]],
    room: ["Laboratory", "lab"]
  }
};

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

  // Corridor along the building; rooms on both sides when it is deep enough.
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
  const toilets = slots >= 3 && core !== slots - 1 ? slots - 1 : -1; // back slot of the washroom
  const alcove = Math.min(3.4, backDepth * 0.5); // depth of the lift lobby
  const lobby = !atEnd && !singleLoaded ? Math.max(0, Math.min(slots - 1, Math.floor((ex + a) / width))) : -1; // front slot of the entrance lobby (first floor)
  const farStairX = atEnd && ex < 0 ? a - 1.6 : -a + 1.6; // second stair: the end away from an end entrance
  const DOOR = 1.0;
  const OPENING = 1.8;

  const files = { "building.json": { building_id: building.properties?.id ?? null, sample: true, note: "Template floors generated by `npm run floors:sample`. The rooms are invented: replace these files with the surveyed floor plans." } };
  if (name) files["building.json"].name = name;
  let roomTotal = 0;

  for (let index = 0; index < floors; index += 1) {
    const number = index + 1;
    const folder = `L${String(number).padStart(2, "0")}`;
    const first = index === 0;
    const last = index === floors - 1 && floors > 1;
    const special = [...(first ? names.ground : last ? names.top : [])];
    let serial = 0;
    const rooms = [];
    const walls = [];
    const pois = [];
    const corridors = [];
    const wall = (kind, geometry) => walls.push(feature({ id: walls.length + 1, kind }, geometry));
    const addRoom = (x0, ya, x1, yb, fixed = null) => {
      serial += 1;
      const [label, type] = fixed || special.shift() || [`${names.room[0]} ${number}${String(serial).padStart(2, "0")}`, names.room[1]];
      rooms.push(feature({ id: `${folder}-${String(serial).padStart(2, "0")}`, name: label, class: type, room_number: `${number}${String(serial).padStart(2, "0")}` }, rectangle(x0, ya, x1, yb)));
    };

    // Walkable: the corridor, the lift lobby and (first floor) the entrance lobby.
    corridors.push(feature({ id: 1, name: "Corridor", class: "corridor" }, rectangle(-a, y0, a, y1)));
    corridors.push(feature({ id: 2, name: "Lift lobby", class: "lobby" }, rectangle(slotStart(core), y1, slotStart(core + 1), y1 + alcove)));
    if (first && lobby >= 0) corridors.push(feature({ id: 3, name: "Entrance lobby", class: "lobby" }, rectangle(slotStart(lobby), -b, slotStart(lobby + 1), y0)));

    // Rooms, their partitions and the corridor walls with a door gap per room.
    const backGaps = [[slotStart(core), slotStart(core + 1)]];
    const frontGaps = [];
    for (let i = 0; i < slots; i += 1) {
      const x0 = slotStart(i), x1 = slotStart(i + 1), middle = (x0 + x1) / 2;
      if (i === core) {
        if (backDepth - alcove > 2.2) {
          addRoom(x0, y1 + alcove, x1, b, ["Store", "store"]);
          withoutGaps(x0, x1, [[middle - DOOR / 2, middle + DOOR / 2]]).forEach(([s, e]) => wall("partition", line([s, y1 + alcove], [e, y1 + alcove])));
        } else wall("partition", line([x0, y1 + alcove], [x1, y1 + alcove]));
      } else {
        addRoom(x0, y1, x1, b, i === toilets ? ["Washroom", "toilet"] : null);
        backGaps.push([middle - DOOR / 2, middle + DOOR / 2]);
      }
      if (i > 0) wall("partition", line([x0, y1], [x0, b]));
      if (singleLoaded) continue;
      if (first && i === lobby) frontGaps.push([x0, x1]);
      else { addRoom(x0, -b, x1, y0); frontGaps.push([middle - DOOR / 2, middle + DOOR / 2]); }
      if (i > 0) wall("partition", line([x0, -b], [x0, y0]));
    }
    withoutGaps(-a, a, backGaps).forEach(([s, e]) => wall("corridor", line([s, y1], [e, y1])));
    if (!singleLoaded) withoutGaps(-a, a, frontGaps).forEach(([s, e]) => wall("corridor", line([s, y0], [e, y0])));

    // Outer walls, with the entrance opening on the first floor.
    const frontOpening = first && !atEnd ? [[ex - OPENING / 2, ex + OPENING / 2]] : [];
    const endOpening = (side) => (first && atEnd && Math.sign(ex) === side ? [[(y0 + y1) / 2 - OPENING / 2, (y0 + y1) / 2 + OPENING / 2]] : []);
    withoutGaps(-a, a, frontOpening).forEach(([s, e]) => wall("outer", line([s, -b], [e, -b])));
    wall("outer", line([-a, b], [a, b]));
    withoutGaps(-b, b, endOpening(-1)).forEach(([s, e]) => wall("outer", line([-a, s], [-a, e])));
    withoutGaps(-b, b, endOpening(1)).forEach(([s, e]) => wall("outer", line([a, s], [a, e])));

    // Points: the lift and the stairs stand at the same place on every floor,
    // which is how the map knows they are the same lift and the same stairs.
    const coreX = slotStart(core);
    pois.push(feature({ id: "lift-a", name: "Lift A", class: "lift" }, point(coreX + width * 0.3, y1 + alcove * 0.6)));
    pois.push(feature({ id: "stair-1", name: "Stair 1", class: "stairs" }, point(coreX + width * 0.7, y1 + alcove * 0.6)));
    pois.push(feature({ id: "stair-2", name: "Stair 2", class: "stairs" }, point(farStairX, (y0 + y1) / 2)));
    if (first) {
      const door = atEnd ? [Math.sign(ex) * a, (y0 + y1) / 2] : [ex, -b];
      pois.push(feature({ id: "entrance", name: "Main Entrance", class: "entrance" }, point(...door)));
      if (lobby >= 0) pois.push(feature({ id: "info", name: "Information Desk", class: "info" }, point(slotStart(lobby) + width * 0.25, y0 - frontDepth * 0.45)));
    }

    files[`${folder}/level.geojson`] = collection("level", [feature({ id: folder, name: `Level ${number}`, short_name: `L${number}` }, building.geometry)]);
    files[`${folder}/corridor.geojson`] = collection("corridor", corridors);
    files[`${folder}/shops.geojson`] = collection("shops", rooms);
    files[`${folder}/walls.geojson`] = collection("walls", walls);
    files[`${folder}/pois.geojson`] = collection("pois", pois);
    roomTotal += rooms.length;
  }
  return { files, summary: { floors, rooms: roomTotal, size: [2 * a, 2 * b].map((value) => Math.round(value * 10) / 10), entrance: atEnd ? "end" : "front" } };
}
