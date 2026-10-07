// What walk mode needs of a building with floor plans (pure, tested with node --test):
// the part of a floor the walker can stand on and what stops him there, where the
// building is entered, the room he is in, and the lift or stairs he stands at.
import { planarDistanceMeters } from "../utils/geo-utils.js";
import { closestOnSegment, createLocalFrame, geometryPolygons, insideRings } from "../utils/local-frame.js";

const SHAFT_REACH_M = 1.5; // a lift or stairs is used from this near its point

// A floor for the walk collision (navigation/collision.js setIndoor): its outline
// is where he can walk (the corridors and rooms when it has no outline), its drawn
// walls stop him, its door points are openings in them. model: a floor of
// indoor-model.js; entrances: [[lon, lat]…], the entrances of the building on it.
export function levelWalkSpace(model, { entrances = [] } = {}) {
  return {
    level: model.id,
    walkable: model.floor.length ? model.floor : [...model.corridors, ...model.units.flatMap((unit) => unit.polygons)],
    walls: model.render.features.filter((feature) => feature.properties.kind === "wall").map((feature) => feature.geometry.coordinates),
    doors: model.doors,
    entrances
  };
}

// Where a building is walked into: its entrance points ([{ level, point, name }]);
// without any, the entrance recorded for the building (entrance_coords), moved
// onto its outline, on the floor the building opens on. building: of
// indoor-store.js; feature: its feature of the buildings file.
export function walkEntrances(building, feature) {
  if (building.entrances.length) return building.entrances.map(({ level, point, name }) => ({ level, point, name: name || "the entrance" }));
  const recorded = feature?.properties?.entrance_coords;
  const level = building.defaultLevel?.id;
  if (level === undefined || !Array.isArray(recorded) || !recorded.slice(0, 2).every(Number.isFinite)) return [];
  const frame = createLocalFrame(recorded);
  const p = frame.toLocal(recorded);
  let nearest = null;
  for (const rings of geometryPolygons(feature.geometry)) for (const ring of rings) for (let i = 1; i < ring.length; i += 1) {
    const hit = closestOnSegment(p, frame.toLocal(ring[i - 1]), frame.toLocal(ring[i]));
    if (!nearest || hit.distance < nearest.distance) nearest = hit;
  }
  return nearest ? [{ level, point: frame.toLngLat(nearest.point), name: "the entrance" }] : [];
}

// The room of a floor at a position, or null (a corridor, a lobby).
export function unitAt(model, point) {
  return model.units.find((unit) => unit.polygons.some((rings) => insideRings(point, rings))) || null;
}

// The lift or stairs (a shaft of indoor-router.js groupShafts) the walker stands
// at on a floor: the nearest within reach, or null.
export function shaftNear(building, levelId, point, reachM = SHAFT_REACH_M) {
  let best = null;
  for (const shaft of building.shafts) {
    const member = shaft.members.get(levelId);
    if (!member) continue;
    const d = planarDistanceMeters(member.point, point, point[1]);
    if (d <= reachM && (!best || d < best.d)) best = { shaft, d };
  }
  return best?.shaft || null;
}

// The floors a lift or stairs stops at, lowest first.
export function shaftLevels(building, shaft) {
  return building.levels.filter((level) => shaft.members.has(level.id));
}
