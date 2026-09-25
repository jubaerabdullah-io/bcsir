// Walk-mode collision (pure, tested with node --test).
//
// The walker is a circle of `radiusM` on the ground. Blockers are polygons
// (building footprints, and the boundary and internal walls as the strips drawn
// on the map); the walker slides along their edges instead of passing through.
//
// Indoor areas: a building listed in `indoor` ({ buildingId, level, walkable:
// [polygon rings…], entrances: [[lon, lat]…] }) can be entered only by walking
// through one of its entrances onto a walkable area of the selected level.
// Inside, movement stays on the walkable areas of that level and leaves the
// building only through an entrance. Buildings without indoor data are solid.
// The BCSIR data has no indoor maps yet, so every building is solid.
import { closestOnSegment, createLocalFrame, distance, geometryPolygons, insideRings, ringsBounds, segmentIntersection } from "./local-frame.js";

const STEP_M = 0.25; // longest move tested at once (smaller than any wall is thick)
const DOOR_HALF_WIDTH_M = 1.1;

export function createCollisionWorld({ blockers = [], indoor = [], radiusM = 0.35, frame } = {}) {
  const firstPoint = blockers[0]?.polygons?.[0]?.[0]?.[0] || [0, 0];
  const localFrame = frame || createLocalFrame(firstPoint);
  const { toLocal, toLngLat } = localFrame;

  const shapes = [];
  blockers.forEach((blocker) => (blocker.polygons || []).forEach((rings) => {
    const local = rings.filter((ring) => ring?.length >= 4).map((ring) => ring.map(toLocal));
    if (local.length) shapes.push({ id: String(blocker.id), name: blocker.name || "", kind: blocker.kind || "building", rings: local, bounds: ringsBounds(local) });
  }));
  const indoorById = new Map();
  indoor.forEach((entry) => {
    const id = String(entry.buildingId);
    const list = indoorById.get(id) || [];
    list.push({
      level: entry.level ?? 0,
      walkable: (entry.walkable || []).map((rings) => rings.map((ring) => ring.map(toLocal))),
      entrances: (entry.entrances || []).map(toLocal)
    });
    indoorById.set(id, list);
  });
  let level = indoor[0]?.level ?? 0;

  const near = (shape, p, margin) => p[0] >= shape.bounds[0] - margin && p[0] <= shape.bounds[2] + margin && p[1] >= shape.bounds[1] - margin && p[1] <= shape.bounds[3] + margin;

  // Doorways of buildings with indoor data are open: near an entrance of the
  // selected level, that building's outline does not block.
  const atDoor = (shape, p) => (indoorById.get(shape.id) || []).some((entry) => entry.level === level && entry.entrances.some((door) => distance(door, p) <= DOOR_HALF_WIDTH_M + radiusM));

  // Deepest overlap of the walker circle at p with any blocker: { shape, depth, push }.
  function deepestContact(p, skipId = null) {
    let contact = null;
    for (const shape of shapes) {
      if (shape.id === skipId || !near(shape, p, radiusM) || atDoor(shape, p)) continue;
      let nearest = null;
      for (const ring of shape.rings) for (let i = 1; i < ring.length; i += 1) {
        const hit = closestOnSegment(p, ring[i - 1], ring[i]);
        if (!nearest || hit.distance < nearest.distance) nearest = { ...hit, a: ring[i - 1], b: ring[i] };
      }
      if (!nearest) continue;
      const inside = insideRings(p, shape.rings);
      if (!inside && nearest.distance >= radiusM) continue;
      const depth = inside ? nearest.distance + radiusM : radiusM - nearest.distance;
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

  function crossesEdges(a, b, skipId = null) {
    for (const shape of shapes) {
      if (shape.id === skipId || (atDoor(shape, a) && atDoor(shape, b))) continue;
      if (Math.max(a[0], b[0]) < shape.bounds[0] || Math.min(a[0], b[0]) > shape.bounds[2] || Math.max(a[1], b[1]) < shape.bounds[1] || Math.min(a[1], b[1]) > shape.bounds[3]) continue;
      for (const ring of shape.rings) for (let i = 1; i < ring.length; i += 1) if (segmentIntersection(a, b, ring[i - 1], ring[i])) return shape;
    }
    return null;
  }

  const shapeContaining = (p) => shapes.find((shape) => near(shape, p, 0) && insideRings(p, shape.rings)) || null;
  const isFree = (p, skipId = null) => !deepestContact(p, skipId);

  function walkableArea(buildingId, p) {
    return (indoorById.get(buildingId) || []).filter((entry) => entry.level === level).find((entry) => entry.walkable.some((rings) => insideRings(p, rings))) || null;
  }
  function throughEntrance(buildingId, a, b) {
    return (indoorById.get(buildingId) || []).filter((entry) => entry.level === level).some((entry) => entry.entrances.some((door) => closestOnSegment(door, a, b).distance <= DOOR_HALF_WIDTH_M));
  }

  // One short step outdoors: push out of blockers (sliding), else fall back to
  // moving along one axis, else stay.
  function outdoorStep(p, q) {
    let x = q;
    let hit = null;
    for (let i = 0; i < 4; i += 1) {
      const contact = deepestContact(x);
      if (!contact) break;
      hit = contact.shape;
      x = [x[0] + contact.push[0], x[1] + contact.push[1]];
    }
    const valid = (candidate) => isFree(candidate) && !crossesEdges(p, candidate);
    if (valid(x)) return { point: x, hit };
    for (const candidate of [[q[0], p[1]], [p[0], q[1]]]) if (valid(candidate)) return { point: candidate, hit: hit || shapeContaining(q) };
    return { point: p, hit: hit || shapeContaining(q) || crossesEdges(p, q) };
  }

  function step(p, q, state) {
    if (state.indoor) {
      const id = state.indoor.buildingId;
      if (walkableArea(id, q)) return { point: q, hit: null };
      const shape = shapes.find((item) => item.id === id);
      const leaving = shape && !insideRings(q, shape.rings) && throughEntrance(id, p, q);
      if (leaving && isFree(q, id)) { state.indoor = null; return { point: q, hit: null }; }
      return { point: p, hit: shape };
    }
    // Entering a building that has indoor data, through an entrance.
    const target = shapeContaining(q);
    if (target && indoorById.has(target.id) && !insideRings(p, target.rings) && throughEntrance(target.id, p, q) && walkableArea(target.id, q)) {
      state.indoor = { buildingId: target.id, level };
      return { point: q, hit: null };
    }
    return outdoorStep(p, q);
  }

  return {
    frame: localFrame,
    radiusM,
    // Position after trying to move from `from` to `to` (lon/lat). `state`
    // ({ indoor }) is updated when an indoor area is entered or left.
    resolveMove(from, to, state = {}) {
      let p = toLocal(from);
      const target = toLocal(to);
      const steps = Math.max(1, Math.ceil(distance(p, target) / STEP_M));
      const delta = [(target[0] - p[0]) / steps, (target[1] - p[1]) / steps];
      let blocker = null;
      for (let i = 0; i < steps; i += 1) {
        const result = step(p, [p[0] + delta[0], p[1] + delta[1]], state);
        if (result.hit) blocker = result.hit;
        p = result.point;
      }
      return { position: toLngLat(p), blocked: Boolean(blocker), blocker: blocker ? { id: blocker.id, name: blocker.name, kind: blocker.kind } : null, state };
    },
    // First blocker outline crossed going from `from` to `to` (lon/lat), as
    // { t (0..1 along the way), id, name, kind }, or null when the way is clear.
    // Used to keep the walk mode's follow camera out of buildings and walls.
    firstHit(from, to) {
      const a = toLocal(from), b = toLocal(to);
      let best = null;
      for (const shape of shapes) {
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
      const contact = deepestContact(toLocal(lngLat));
      return contact ? { id: contact.shape.id, name: contact.shape.name, kind: contact.shape.kind } : null;
    },
    // Nearest free position to lngLat (itself when free), searching up to 80 m.
    nearestFree(lngLat) {
      const p = toLocal(lngLat);
      if (isFree(p)) return lngLat;
      let x = p;
      for (let i = 0; i < 12; i += 1) {
        const contact = deepestContact(x);
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
    setLevel(next) { level = next; },
    level: () => level,
    hasIndoor: (buildingId) => indoorById.has(String(buildingId))
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
