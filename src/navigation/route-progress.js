// Turn-by-turn guidance along a drawn walking route (pure, tested with node --test).
//
// createRouteModel(coordinates) measures the route in a local metric frame and
// derives its manoeuvres: a turn wherever the walking direction changes by 28°
// or more, judged over 7 m before and after each vertex so that digitised
// curves do not produce a turn at every vertex; turns closer than 10 m are
// merged into the sharpest one. locate() snaps a position to the route and
// guidance() gives the next manoeuvre and the remaining distance.
import { angleDelta, bearingOf, closestOnSegment, createLocalFrame, distance, lerp } from "./local-frame.js";

const LOOK_M = 7;
const MIN_TURN_DEG = 28;
const MERGE_M = 10;
const THEN_WITHIN_M = 25; // "then …" is shown when the following manoeuvre is this close

export function turnType(angle) {
  const size = Math.abs(angle);
  const side = angle < 0 ? "left" : "right";
  if (size >= 165) return "uturn";
  if (size >= 130) return `sharp-${side}`;
  if (size >= 50) return side;
  return `slight-${side}`;
}

function dedupe(coordinates) {
  const output = [];
  for (const point of coordinates || []) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const last = output[output.length - 1];
    if (!last || Math.abs(last[0] - point[0]) > 1e-9 || Math.abs(last[1] - point[1]) > 1e-9) output.push([point[0], point[1]]);
  }
  return output;
}

// Local point `along` metres from the start (clamped to the route).
export function pointAt(model, along) {
  const { points, cumulative, total } = model;
  const d = Math.max(0, Math.min(total, along));
  let i = 1;
  while (i < points.length - 1 && cumulative[i] < d) i += 1;
  const length = cumulative[i] - cumulative[i - 1];
  return lerp(points[i - 1], points[i], length > 0 ? (d - cumulative[i - 1]) / length : 0);
}

// Walking direction (compass degrees) at `along`, over the next `ahead` metres.
export function bearingAt(model, along, ahead = LOOK_M) {
  if (model.total <= 0) return 0;
  const start = Math.min(along, Math.max(0, model.total - 0.5));
  const a = pointAt(model, start);
  const b = pointAt(model, Math.min(model.total, start + Math.max(0.5, ahead)));
  return distance(a, b) > 1e-6 ? bearingOf(a, b) : 0;
}

function computeManeuvers(model) {
  const { points, cumulative, total } = model;
  const candidates = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = cumulative[i];
    const before = pointAt(model, d - LOOK_M);
    const after = pointAt(model, d + LOOK_M);
    if (distance(before, points[i]) < 1 || distance(points[i], after) < 1) continue;
    const bearingIn = bearingOf(before, points[i]);
    const bearingOut = bearingOf(points[i], after);
    const angle = angleDelta(bearingIn, bearingOut);
    if (Math.abs(angle) >= MIN_TURN_DEG) candidates.push({ along: d, angle, bearingIn, bearingOut, point: points[i] });
  }
  const kept = [];
  candidates.sort((a, b) => Math.abs(b.angle) - Math.abs(a.angle)).forEach((candidate) => {
    if (kept.every((other) => Math.abs(other.along - candidate.along) >= MERGE_M)) kept.push(candidate);
  });
  kept.sort((a, b) => a.along - b.along);
  const maneuvers = [
    { type: "depart", along: 0, angle: 0, bearingOut: bearingAt(model, 0), point: points[0] },
    ...kept.filter((m) => m.along > 1 && m.along < total - 1).map((m) => ({ ...m, type: turnType(m.angle) })),
    { type: "arrive", along: total, angle: 0, point: points[points.length - 1] }
  ];
  return maneuvers;
}

// coordinates: [[lon, lat], ...] from the start to the destination.
export function createRouteModel(coordinates, { frame } = {}) {
  const clean = dedupe(coordinates);
  if (clean.length < 2) return null;
  const localFrame = frame || createLocalFrame(clean[0]);
  const points = clean.map(localFrame.toLocal);
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
  const model = { coordinates: clean, frame: localFrame, points, cumulative, total: cumulative[cumulative.length - 1] };
  model.maneuvers = computeManeuvers(model);
  return model;
}

// Nearest point of the route to lngLat. With `hint` (the previous `along`) the
// search prefers the part of the route just around it, so a route that passes
// the same place twice does not jump back; it falls back to the whole route
// when that part is far away.
export function locate(model, lngLat, { hint = null } = {}) {
  const p = model.frame.toLocal(lngLat);
  const search = (from, to) => {
    let best = null;
    for (let i = 1; i < model.points.length; i += 1) {
      if (model.cumulative[i] < from || model.cumulative[i - 1] > to) continue;
      const hit = closestOnSegment(p, model.points[i - 1], model.points[i]);
      if (!best || hit.distance < best.offsetM) {
        best = { along: model.cumulative[i - 1] + hit.t * (model.cumulative[i] - model.cumulative[i - 1]), offsetM: hit.distance, point: hit.point, segment: i - 1 };
      }
    }
    return best;
  };
  let best = Number.isFinite(hint) ? search(hint - 20, hint + 80) : null;
  if (!best || best.offsetM > 25) {
    const global = search(-Infinity, Infinity);
    if (!best || global.offsetM < best.offsetM - 5) best = global;
  }
  return { ...best, lngLat: model.frame.toLngLat(best.point), bearing: bearingAt(model, best.along) };
}

// Next manoeuvre after `along`, the distance to it, the one after it when it
// follows closely, and the distance left to the destination.
export function guidance(model, along) {
  const upcoming = model.maneuvers.filter((m) => m.type !== "depart" && m.along > along + 0.5);
  const next = upcoming[0] || model.maneuvers[model.maneuvers.length - 1];
  const following = upcoming[1] && upcoming[1].along - next.along <= THEN_WITHIN_M ? upcoming[1] : null;
  return {
    next,
    distanceToNext: Math.max(0, next.along - along),
    following,
    remaining: Math.max(0, model.total - along)
  };
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
export function compassWord(bearing) {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

const TURN_TEXT = {
  left: "Turn left",
  right: "Turn right",
  "slight-left": "Keep left",
  "slight-right": "Keep right",
  "sharp-left": "Turn sharp left",
  "sharp-right": "Turn sharp right",
  uturn: "Turn around"
};

export function maneuverText(maneuver, destinationName = "") {
  if (!maneuver) return "";
  if (maneuver.type === "arrive") return destinationName ? `Arrive at ${destinationName}` : "Arrive at your destination";
  if (maneuver.type === "depart") return `Head ${compassWord(maneuver.bearingOut)}`;
  return TURN_TEXT[maneuver.type] || "Continue";
}

// Rounded like spoken guidance: 1 m steps up to 20 m, then 5 m, then 10 m.
export function formatGuidanceDistance(metres) {
  if (!Number.isFinite(metres)) return "";
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  const step = metres < 20 ? 1 : metres < 100 ? 5 : 10;
  return `${Math.max(0, Math.round(metres / step) * step)} m`;
}
