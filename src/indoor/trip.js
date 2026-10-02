// A trip that may start or end inside a building (pure, tested with node --test).
//
// The walk between two buildings is the organisation's outdoor route (the road
// network). This module adds the indoor parts and puts the whole trip into words:
//
//   room on floor 6 of A  ->  lift  ->  entrance of A  ->  roads  ->  entrance of B
//   ->  lift  ->  room on floor 3 of B
//
// planIndoorTrip() finds the indoor parts (indoor-store.js). describeTrip() gives
// the summary and the step list of the directions panel.
import { CONNECTOR_CLASSES } from "./levels.js";
import { WALK_SPEED_MPS } from "./indoor-router.js";

// source / destination: { key, uid, door }
//   key   indoor building of the chosen building (indoor-store.js), or null
//   uid   the chosen room or point in it, or null when the building itself was chosen
//   door  [lon, lat] where the outdoor route meets that building, or null
// sameBuilding: both ends are in the same building (no outdoor walk).
// Resolves to { start, end, problems }: the indoor route at the start and at the
// end of the trip (each a routeBetween() result, or null when that end is outdoors).
export async function planIndoorTrip({ store, source, destination, sameBuilding = false, stepFree = false }) {
  const problems = [];
  const anchorOf = async (end, role) => {
    if (!end.uid) return store.entranceAnchor(end.key, end.door);
    const anchor = await store.placeAnchor(end.uid);
    if (!anchor) problems.push(`${store.place(end.uid)?.name || "That place"} cannot be reached from the walkable area of its floor, so the route ${role === "source" ? "starts" : "ends"} at the building.`);
    return anchor;
  };
  const between = async (key, from, to) => (from && to ? store.routeBetween(key, from, to, { stepFree }) : null);

  if (sameBuilding) {
    if (!source.key || (!source.uid && !destination.uid)) return { start: null, end: null, problems };
    const from = await anchorOf({ ...source, key: source.key }, "source");
    const to = await anchorOf({ ...destination, key: source.key }, "destination");
    return { start: await between(source.key, from, to), end: null, problems };
  }
  let start = null, end = null;
  if (source.key && source.uid) {
    const from = await anchorOf(source, "source");
    start = await between(source.key, from, from ? await store.entranceAnchor(source.key, source.door) : null);
  }
  if (destination.key && destination.uid) {
    const to = await anchorOf(destination, "destination");
    end = await between(destination.key, to ? await store.entranceAnchor(destination.key, destination.door) : null, to);
  }
  return { start, end, problems };
}

export function formatMetres(metres) {
  if (!Number.isFinite(metres)) return "";
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.max(1, Math.round(metres))} m`;
}
const minutes = (seconds) => Math.max(1, Math.round(seconds / 60));
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const FAILURES = {
  "no-connector": "no lift or stairs are recorded in this building",
  "no-connector-route": "no lift or stairs join those floors",
  "not-connected": "the corridors of that floor do not join the two places",
  "not-reachable": "the place is not beside a walkable area",
  "floor-not-loaded": "the floor plan could not be loaded"
};

// Steps of one indoor part. levelShort(key, levelId) gives the floor's button label.
function indoorSteps(part, { buildingName, levelShort }) {
  return part.legs.map((leg) => {
    if (leg.type === "connector") {
      const kind = CONNECTOR_CLASSES[leg.class]?.label || "Stairs";
      const named = leg.name && leg.name.toLowerCase() !== kind.toLowerCase() ? leg.name : `the ${kind.toLowerCase()}`;
      return {
        kind: "connector",
        icon: leg.class,
        title: `Take ${named} ${leg.direction} to ${levelShort(part.building, leg.toLevel)}`,
        detail: `${plural(leg.floors, "floor")} ${leg.direction} · ${buildingName(part.building)}`,
        building: part.building,
        level: leg.fromLevel,
        nextLevel: leg.toLevel,
        point: leg.point
      };
    }
    return {
      kind: "walk",
      icon: leg.toConnector || "walk",
      title: `Walk to ${leg.to}`,
      detail: `${levelShort(part.building, leg.level)} · ${formatMetres(leg.distanceM)} · ${buildingName(part.building)}`,
      building: part.building,
      level: leg.level,
      coordinates: leg.coordinates
    };
  });
}

// outdoor: { ok, networkDistanceM, coordinates, description } of the outdoor route
//          (description: route-summary.js describeRoute), or null when the trip
//          stays in one building.
// start / end / problems: planIndoorTrip().
// Returns { status, headline, detail, notes, steps, navigable, seconds, metres }.
export function describeTrip({ outdoor = null, start = null, end = null, problems = [], destinationName = "the destination", buildingName = (key) => key, levelShort = (key, id) => id }) {
  const notes = [...(outdoor?.description?.notes || []), ...problems];
  const context = { buildingName, levelShort };
  const parts = [start, end].filter(Boolean);
  for (const part of parts) if (!part.ok) notes.push(`No indoor route in ${buildingName(part.building)}: ${FAILURES[part.reason] || "it could not be calculated"}.`);
  const indoorOk = parts.filter((part) => part.ok);

  // Outdoor only, or an outdoor route that failed: the outdoor summary stands.
  if (!indoorOk.length) {
    if (outdoor) return { ...outdoor.description, notes, steps: [], navigable: Boolean(outdoor.ok && outdoor.networkDistanceM > 0), seconds: (outdoor.networkDistanceM || 0) / WALK_SPEED_MPS, metres: outdoor.networkDistanceM || 0 };
    return { status: "error", headline: "Route unavailable", detail: "A route inside this building could not be calculated.", notes, steps: [], navigable: false, seconds: 0, metres: 0 };
  }
  if (outdoor && !outdoor.ok) return { ...outdoor.description, notes, steps: [], navigable: false, seconds: 0, metres: 0 };

  const outdoorMetres = outdoor?.networkDistanceM || 0;
  const indoorMetres = indoorOk.reduce((sum, part) => sum + part.distanceM, 0);
  const seconds = outdoorMetres / WALK_SPEED_MPS + indoorOk.reduce((sum, part) => sum + part.seconds, 0);
  const floorChanges = indoorOk.reduce((sum, part) => sum + part.floorChanges, 0);

  const steps = [];
  if (start?.ok) steps.push(...indoorSteps(start, context));
  if (outdoor && outdoorMetres > 0) steps.push({ kind: "outdoor", icon: "outdoor", title: `Walk outside to ${destinationName}`, detail: `${formatMetres(outdoorMetres)} along roads and paths`, building: null, level: null, coordinates: outdoor.coordinates });
  if (end?.ok) steps.push(...indoorSteps(end, context));

  const pieces = [];
  if (outdoorMetres > 0) pieces.push(`${formatMetres(outdoorMetres)} outside`);
  pieces.push(`${formatMetres(indoorMetres)} inside`);
  if (floorChanges) pieces.push(plural(floorChanges, "floor change"));
  return {
    status: "ok",
    headline: `${minutes(seconds)} min · ${formatMetres(outdoorMetres + indoorMetres)}`,
    detail: pieces.join(" · "),
    notes,
    steps,
    navigable: Boolean(outdoor?.ok && outdoorMetres > 0),
    seconds,
    metres: outdoorMetres + indoorMetres,
    floorChanges
  };
}
