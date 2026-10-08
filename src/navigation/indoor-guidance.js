// Guidance inside the destination building in 3D mode (pure, tested with node --test).
//
// The indoor part of a trip (indoor/trip.js: walk legs on one floor, and lift or
// stairs legs between floors) becomes a list of stages: walk along a leg to its end,
// change floor, walk on. nextIndoorStage() finds the stage the walker is at from
// where he is: a walk leg is done when he has reached its end on its floor, a floor
// change when he is on the floor it goes to. A floor reached another way (another
// lift, the stairs) skips ahead to the walk on that floor.
import { createRouteModel, locate } from "./route-progress.js";

export const INDOOR_ARRIVAL_M = 2; // the end of a walk leg is reached this near
const ON_LEG_M = 3; // ... and this near the leg

// Stages of the indoor legs: walk legs get their route model (route-progress.js).
export function indoorStages(legs) {
  return (legs || [])
    .map((leg) => (leg.type === "walk" ? { ...leg, model: createRouteModel(leg.coordinates) } : { ...leg }))
    .filter((stage) => stage.type !== "walk" || stage.model);
}

// The stage the walker is at: `index` is the stage he was at, `where` the building
// and floor he is on ({ building, level }, null outdoors), `position` [lon, lat].
// stages.length once he has reached the end of the last one.
export function nextIndoorStage(stages, index, where, position) {
  let current = Math.max(0, index);
  for (let step = 0; step <= stages.length && current < stages.length; step += 1) {
    const stage = stages[current];
    const inside = Boolean(where) && where.building === stage.building;
    const floor = stage.type === "walk" ? stage.level : stage.fromLevel;
    if (inside && where.level !== floor && !(stage.type === "connector" && where.level === stage.toLevel)) {
      const later = stages.findIndex((item, i) => i > current && item.type === "walk" && item.level === where.level);
      if (later > current) { current = later; continue; }
    }
    if (stage.type === "connector") {
      if (inside && where.level === stage.toLevel) { current += 1; continue; }
      return current;
    }
    const progress = position ? locate(stage.model, position) : null;
    if (inside && where.level === stage.level && progress && progress.along >= stage.model.total - INDOOR_ARRIVAL_M && progress.offsetM <= ON_LEG_M) { current += 1; continue; }
    return current;
  }
  return current;
}

// What remains to walk after stage `index` (metres of the later walk legs).
export function remainingAfter(stages, index) {
  return stages.slice(index + 1).reduce((sum, stage) => sum + (stage.type === "walk" ? stage.model.total : 0), 0);
}
