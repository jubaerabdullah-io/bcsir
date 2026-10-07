// Walk-mode collision (pure, tested with node --test).
//
// The walker is a circle of `radiusM` on the ground. Blockers are polygons
// (building footprints, and the boundary and internal walls as the strips drawn
// on the map); the walker slides along their edges instead of passing through.
//
// Indoors: a building with floor plans has one entry per floor ({ buildingId, level,
// walkable: [polygon rings…], walls: [polygon rings…], doors: [[lon, lat]…],
// entrances: [[lon, lat]…] }; setIndoor() adds a floor when its files are loaded).
// Such a building is entered by walking through one of its entrances, onto the
// floor that entrance is on. Inside, the walker (a smaller circle, `indoorRadiusM`,
// so that a door one metre wide is easy to pass) stays on the walkable area of his
// floor, cannot pass its walls except through their gaps and at the door points, and
// leaves the building only through an entrance of that floor. `state.indoor`
// ({ buildingId, level }) says where he is; changing floor is changing its `level`.
// A building without indoor data is solid.
import { closestOnSegment, createLocalFrame, distance, geometryPolygons, insideRings, ringsBounds, segmentIntersection } from "../utils/local-frame.js";

const STEP_M = 0.25; // longest move tested at once (walls thinner than this are caught by the crossing test)
const DOOR_HALF_WIDTH_M = 1.1; // an entrance of a building
const ROOM_DOOR_HALF_WIDTH_M = 0.55; // a door point inside (doors.geojson)

export function createCollisionWorld({ blockers = [], indoor = [], radiusM = 0.35, indoorRadiusM = 0.22, frame } = {}) {
  const firstPoint = blockers[0]?.polygons?.[0]?.[0]?.[0] || [0, 0];
  const localFrame = frame || createLocalFrame(firstPoint);
  const { toLocal, toLngLat } = localFrame;
  const toShape = (rings, properties) => {
    const local = rings.filter((ring) => ring?.length >= 4).map((ring) => ring.map(toLocal));
    return local.length ? { ...properties, rings: local, bounds: ringsBounds(local) } : null;
  };

  const shapes = [];
  blockers.forEach((blocker) => (blocker.polygons || []).forEach((rings) => {
    const shape = toShape(rings, { id: String(blocker.id), name: blocker.name || "", kind: blocker.kind || "building" });
    if (shape) shapes.push(shape);
  }));
  const indoorById = new Map(); // building id -> its floors
  function setIndoor(entry) {
    const id = String(entry.buildingId);
    const level = entry.level ?? 0;
    const floors = (indoorById.get(id) || []).filter((floor) => floor.level !== level);
    floors.push({
      level,
      walkable: (entry.walkable || []).map((rings) => rings.map((ring) => ring.map(toLocal))),
      walls: (entry.walls || []).map((rings) => toShape(rings, { id: `${id}/${level}/wall`, name: "", kind: "indoor-wall" })).filter(Boolean),
      doors: (entry.doors || []).map(toLocal),
      entrances: (entry.entrances || []).map(toLocal)
    });
    indoorById.set(id, floors);
  }
  indoor.forEach(setIndoor);
  // When set, only this floor's entrances lead inside; null: those of every floor.
  let level = null;

  const near = (shape, p, margin) => p[0] >= shape.bounds[0] - margin && p[0] <= shape.bounds[2] + margin && p[1] >= shape.bounds[1] - margin && p[1] <= shape.bounds[3] + margin;
  const floorOf = (id, levelId) => (indoorById.get(id) || []).find((floor) => floor.level === levelId) || null;
  // Floors of a building that can be walked into from outside.
  const enterable = (id) => (indoorById.get(id) || []).filter((floor) => floor.entrances.length && (level === null || floor.level === level));
  const onFloor = (floor, p) => floor.walkable.some((rings) => insideRings(p, rings));
  const atEntrance = (floor, p) => floor.entrances.some((door) => distance(door, p) <= DOOR_HALF_WIDTH_M + radiusM);
  const throughEntrance = (floor, a, b) => floor.entrances.some((door) => closestOnSegment(door, a, b).distance <= DOOR_HALF_WIDTH_M + radiusM);
  // In a doorway the walls of the floor do not block.
  const inDoorway = (floor, p) => atEntrance(floor, p) || floor.doors.some((door) => distance(door, p) <= ROOM_DOOR_HALF_WIDTH_M);

  // Doorways of buildings with indoor data are open: near an entrance, that
  // building's outline does not block.
  const outdoorOpening = (enter) => (enter ? (shape, p) => enterable(shape.id).some((floor) => atEntrance(floor, p)) : () => false);
  const closed = () => false;

  // Deepest overlap of a circle of `radius` at p with the shapes of `list`:
  // { shape, depth, push }. `open(shape, p)`: the shape does not block at p.
  function deepestContact(p, list, radius, open, skipId = null) {
    let contact = null;
    for (const shape of list) {
      if (shape.id === skipId || !near(shape, p, radius) || open(shape, p)) continue;
      let nearest = null;
      for (const ring of shape.rings) for (let i = 1; i < ring.length; i += 1) {
        const hit = closestOnSegment(p, ring[i - 1], ring[i]);
        if (!nearest || hit.distance < nearest.distance) nearest = { ...hit, a: ring[i - 1], b: ring[i] };
      }
      if (!nearest) continue;
      const inside = insideRings(p, shape.rings);
      if (!inside && nearest.distance >= radius) continue;
      const depth = inside ? nearest.distance + radius : radius - nearest.distance;
      let dx = p[0] - nearest.point[0], dy = p[1] - nearest.point[1];
      const length = Math.hypot(dx, dy);
      if (length < 1e-9) {
        // Exactly on the outline: push along the edge normal, to the outside.
        const ex = nearest.b[0] - nearest.a[0], ey = nearest.b[1] - nearest.a[1], edge = Math.hypot(ex, ey) || 1;
        dx = -ey / edge; dy = ex / edge;
        if (insideRings([p[0] + dx * 1e-3, p[1] + dy * 1e-3], shape.rings)) { dx = -dx; dy = -dy; }
      } else {
        dx /= length; dy /= length;
        if (inside) { dx = -dx; dy = -dy; }
      }
      if (!contact || depth > contact.depth) contact = { shape, depth, push: [dx * (depth + 1e-4), dy * (depth + 1e-4)] };
    }
    return contact;
  }

  function crossesEdges(a, b, list, open, skipId = null) {
    for (const shape of list) {
      if (shape.id === skipId || (open(shape, a) && open(shape, b))) continue;
      if (Math.max(a[0], b[0]) < shape.bounds[0] || Math.min(a[0], b[0]) > shape.bounds[2] || Math.max(a[1], b[1]) < shape.bounds[1] || Math.min(a[1], b[1]) > shape.bounds[3]) continue;
      for (const ring of shape.rings) for (let i = 1; i < ring.length; i += 1) if (segmentIntersection(a, b, ring[i - 1], ring[i])) return shape;
    }
    return null;
  }

  // A point pushed out of the shapes it overlaps (sliding along them): { point, hit }.
  function pushedOut(q, list, radius, open) {
    let point = q, hit = null;
    for (let i = 0; i < 4; i += 1) {
      const contact = deepestContact(point, list, radius, open);
      if (!contact) break;
      hit = contact.shape;
      point = [point[0] + contact.push[0], point[1] + contact.push[1]];
    }
    return { point, hit };
  }

  const shapeContaining = (p) => shapes.find((shape) => near(shape, p, 0) && insideRings(p, shape.rings)) || null;
  // Free of every outdoor blocker (doorways closed), leaving out the building `skipId`.
  const isFree = (p, skipId = null) => !deepestContact(p, shapes, radiusM, closed, skipId);
  const isFreeIndoors = (floor, p) => onFloor(floor, p) && !deepestContact(p, floor.walls, indoorRadiusM, closed);

  // One short step outdoors: push out of blockers (sliding), else fall back to
  // moving along one axis, else stay.
  function outdoorStep(p, q, open) {
    const { point: x, hit } = pushedOut(q, shapes, radiusM, open);
    const valid = (candidate) => !deepestContact(candidate, shapes, radiusM, open) && !crossesEdges(p, candidate, shapes, open);
    if (valid(x)) return { point: x, hit };
    for (const candidate of [[q[0], p[1]], [p[0], q[1]]]) if (valid(candidate)) return { point: candidate, hit: hit || shapeContaining(q) };
    return { point: p, hit: hit || shapeContaining(q) || crossesEdges(p, q, shapes, open) };
  }

  // A point just outside the floor's walkable area, moved back onto it.
  function pulledOnto(floor, p) {
    let nearest = null;
    for (const rings of floor.walkable) for (const ring of rings) for (let i = 1; i < ring.length; i += 1) {
      const hit = closestOnSegment(p, ring[i - 1], ring[i]);
      if (!nearest || hit.distance < nearest.distance) nearest = hit;
    }
    if (!nearest || nearest.distance < 1e-9) return null;
    const k = 0.02 / nearest.distance;
    const point = [nearest.point[0] + (nearest.point[0] - p[0]) * k, nearest.point[1] + (nearest.point[1] - p[1]) * k];
    return onFloor(floor, point) ? point : null;
  }

  // One short step inside a building, on the floor of `state.indoor`.
  function indoorStep(p, q, state) {
    const id = state.indoor.buildingId;
    const floor = floorOf(id, state.indoor.level);
    const shape = shapes.find((item) => item.id === id) || null;
    if (!floor) return { point: p, hit: shape }; // that floor is not loaded: stay
    const inBuilding = (x) => !shape || insideRings(x, shape.rings);
    // On the walkable area, or on the threshold between it and the building's outline.
    const inside = (x) => onFloor(floor, x) || (atEntrance(floor, x) && inBuilding(x));
    const open = (wall, x) => inDoorway(floor, x);
    const valid = (x) => inside(x) && !deepestContact(x, floor.walls, indoorRadiusM, open) && !crossesEdges(p, x, floor.walls, open);

    // Out of the building, through an entrance of this floor.
    if (!inBuilding(q) && throughEntrance(floor, p, q) && isFree(q, id)) { state.indoor = null; return { point: q, hit: null }; }
    let { point: x, hit } = pushedOut(q, floor.walls, indoorRadiusM, open);
    if (!inside(x)) { x = pulledOnto(floor, x) || x; hit = hit || shape; }
    if (valid(x)) return { point: x, hit };
    for (const candidate of [[q[0], p[1]], [p[0], q[1]]]) if (valid(candidate)) return { point: candidate, hit: hit || shape };
    return { point: p, hit: hit || shape || floor.walls[0] || null };
  }

  function step(p, q, state, enter) {
    if (state.indoor) return indoorStep(p, q, state);
    // Entering a building that has indoor data, through an entrance.
    const target = enter ? shapeContaining(q) : null;
    const floor = target ? enterable(target.id).find((item) => throughEntrance(item, p, q)) : null;
    if (floor) {
      state.indoor = { buildingId: target.id, level: floor.level };
      return { point: q, hit: null };
    }
    return outdoorStep(p, q, outdoorOpening(enter));
  }

  const describe = (shape) => ({ id: shape.id, name: shape.name, kind: shape.kind, ...(shape.kind === "building" && indoorById.has(shape.id) ? { indoor: true } : {}) });

  return {
    frame: localFrame,
    radiusM,
    indoorRadiusM,
    // Position after trying to move from `from` to `to` (lon/lat). `state`
    // ({ indoor }) is updated when a building is entered or left. `enter: false`
    // keeps every building solid for this move (no building is entered).
    resolveMove(from, to, state = {}, { enter = true } = {}) {
      let p = toLocal(from);
      const target = toLocal(to);
      const steps = Math.max(1, Math.ceil(distance(p, target) / STEP_M));
      const delta = [(target[0] - p[0]) / steps, (target[1] - p[1]) / steps];
      let blocker = null;
      for (let i = 0; i < steps; i += 1) {
        const result = step(p, [p[0] + delta[0], p[1] + delta[1]], state, enter);
        if (result.hit) blocker = result.hit;
        p = result.point;
      }
      return { position: toLngLat(p), blocked: Boolean(blocker), blocker: blocker ? describe(blocker) : null, state };
    },
    // First blocker outline crossed going from `from` to `to` (lon/lat), as
    // { t (0..1 along the way), id, name, kind }, or null when the way is clear.
    // Used to keep the walk mode's follow camera out of buildings and walls; with
    // the walker's `state`, the walls of the floor he is on count too.
    firstHit(from, to, state = null) {
      const a = toLocal(from), b = toLocal(to);
      const floor = state?.indoor ? floorOf(state.indoor.buildingId, state.indoor.level) : null;
      let best = null;
      for (const shape of floor ? [...shapes, ...floor.walls] : shapes) {
        if (Math.max(a[0], b[0]) < shape.bounds[0] || Math.min(a[0], b[0]) > shape.bounds[2] || Math.max(a[1], b[1]) < shape.bounds[1] || Math.min(a[1], b[1]) > shape.bounds[3]) continue;
        for (const ring of shape.rings) for (let i = 1; i < ring.length; i += 1) {
          const hit = segmentIntersection(a, b, ring[i - 1], ring[i]);
          if (hit && (!best || hit.t < best.t)) best = { t: hit.t, shape };
        }
      }
      return best ? { t: best.t, id: best.shape.id, name: best.shape.name, kind: best.shape.kind } : null;
    },
    // Blocker at a lon/lat (inside it or closer than the walker radius), or null.
    blockerAt(lngLat) {
      const contact = deepestContact(toLocal(lngLat), shapes, radiusM, closed);
      return contact ? describe(contact.shape) : null;
    },
    // Nearest free position to lngLat (itself when free), searching up to 80 m.
    nearestFree(lngLat) {
      const p = toLocal(lngLat);
      if (isFree(p)) return lngLat;
      let x = p;
      for (let i = 0; i < 12; i += 1) {
        const contact = deepestContact(x, shapes, radiusM, closed);
        if (!contact) return toLngLat(x);
        x = [x[0] + contact.push[0] * 1.05, x[1] + contact.push[1] * 1.05];
      }
      for (let r = 0.5; r <= 80; r += 0.5) {
        const count = Math.max(12, Math.round(r * 4));
        let best = null;
        for (let k = 0; k < count; k += 1) {
          const angle = (k / count) * Math.PI * 2;
          const candidate = [p[0] + Math.cos(angle) * r, p[1] + Math.sin(angle) * r];
          if (isFree(candidate)) { best = candidate; break; }
        }
        if (best) return toLngLat(best);
      }
      return lngLat;
    },
    // Nearest place to stand on a floor of a building (on its walkable area, clear
    // of its walls) to lngLat, searching up to 30 m; null when that floor is not
    // loaded or has no such place.
    nearestIndoor(lngLat, buildingId, levelId) {
      const floor = floorOf(String(buildingId), levelId);
      if (!floor) return null;
      const p = toLocal(lngLat);
      if (isFreeIndoors(floor, p)) return lngLat;
      for (let r = 0.25; r <= 30; r += 0.25) {
        const count = Math.max(12, Math.round(r * 8));
        for (let k = 0; k < count; k += 1) {
          const angle = (k / count) * Math.PI * 2;
          const candidate = [p[0] + Math.cos(angle) * r, p[1] + Math.sin(angle) * r];
          if (isFreeIndoors(floor, candidate)) return toLngLat(candidate);
        }
      }
      return null;
    },
    // Adds a floor of a building with floor plans, or replaces it (see the top).
    setIndoor,
    setLevel(next) { level = next ?? null; },
    level: () => level,
    hasIndoor: (buildingId) => indoorById.has(String(buildingId)),
    hasFloor: (buildingId, levelId) => Boolean(floorOf(String(buildingId), levelId))
  };
}

// A building footprint stands in the way when it is at least 0.5 m tall and
// starts below head height. Flat areas drawn 0.3 m high (research field, pond,
// play ground) are left walkable, and so is the space under a raised building.
export function blocksWalking(feature, { minHeightM = 0.5, headroomM = 2.2 } = {}) {
  const p = feature?.properties || {};
  const base = Number(p.render_base_m) || 0;
  const top = Number(p.render_top_m) || 0;
  return top - base >= minHeightM && base < headroomM;
}

// Blockers from the map datasets: the building footprints that block walking,
// plus wall strips.
export function collisionBlockers({ buildings, walls = [] } = {}) {
  const blockers = [];
  (buildings?.features || []).forEach((feature) => {
    if (!blocksWalking(feature)) return;
    const p = feature.properties || {};
    blockers.push({ id: String(p.render_id ?? p.id), name: String(p.name_en || p.render_label || "").trim(), kind: "building", polygons: geometryPolygons(feature.geometry) });
  });
  walls.forEach(({ collection, kind = "wall", name = "Wall" }) => (collection?.features || []).forEach((feature, index) => {
    const polygons = geometryPolygons(feature.geometry);
    if (polygons.length) blockers.push({ id: `${kind}-${feature.properties?.render_id ?? index}`, name, kind, polygons });
  }));
  return blockers;
}
