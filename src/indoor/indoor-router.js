// Routes inside one building, across its floors (pure, tested with node --test).
//
// A route between two places on different floors goes:
//   start  ->  the lift or stairs that give the quickest way  ->  (ride or climb
//   directly to the destination floor)  ->  destination
// The lift and the stairs are the "connector" points of pois.geojson (class lift,
// stairs, escalator, ramp). Points of the same kind standing at the same place on
// different floors are one shaft (or they share a connector_id); a shaft takes you
// from any of its floors directly to any other. When no single shaft serves both
// floors, the route changes shaft on a floor in between.
//
// Times decide the choice: walking at 5 km/h, a lift 20 s + 3 s per floor, stairs
// 16 s per floor, an escalator 12 s per floor, a ramp 25 s per floor. "Step-free"
// routes use lifts and ramps only.
import { planarDistanceMeters } from "../utils/geo-utils.js";
import { CONNECTOR_CLASSES } from "./levels.js";

export const WALK_SPEED_MPS = 5 / 3.6;
export const CONNECTOR_SECONDS = {
  lift: { wait: 20, perFloor: 3 },
  stairs: { wait: 0, perFloor: 16 },
  escalator: { wait: 0, perFloor: 12 },
  ramp: { wait: 0, perFloor: 25 }
};
const SAME_SHAFT_M = 4; // connectors of one kind within this distance on different floors are one shaft

// Groups the connector points of a building into shafts.
// connectors: [{ uid, class, name, level, point, connector_id? }]
// Returns [{ id, class, name, members: Map(level id -> connector) }].
export function groupShafts(connectors) {
  const shafts = [];
  const named = new Map();
  for (const connector of connectors) {
    if (!CONNECTOR_CLASSES[connector.class]) continue;
    let shaft = null;
    if (connector.connector_id !== undefined && connector.connector_id !== null && connector.connector_id !== "") {
      const key = `${connector.class}:${connector.connector_id}`;
      shaft = named.get(key);
      if (!shaft) { shaft = { id: key, class: connector.class, name: connector.name || "", members: new Map() }; named.set(key, shaft); shafts.push(shaft); }
    } else {
      // The nearest shaft of this kind that does not have this floor yet.
      let best = Infinity;
      for (const candidate of shafts) {
        if (candidate.explicit || candidate.class !== connector.class || candidate.members.has(connector.level)) continue;
        const d = Math.min(...[...candidate.members.values()].map((member) => planarDistanceMeters(member.point, connector.point)));
        if (d <= SAME_SHAFT_M && d < best) { best = d; shaft = candidate; }
      }
      if (!shaft) { shaft = { id: `${connector.class}:${shafts.length + 1}`, class: connector.class, name: connector.name || "", members: new Map() }; shafts.push(shaft); }
    }
    if (connector.connector_id !== undefined && connector.connector_id !== null && connector.connector_id !== "") shaft.explicit = true;
    if (!shaft.name && connector.name) shaft.name = connector.name;
    if (!shaft.members.has(connector.level)) shaft.members.set(connector.level, connector);
  }
  return shafts.filter((shaft) => shaft.members.size > 0);
}

export function connectorSeconds(type, floors) {
  const rule = CONNECTOR_SECONDS[type] || CONNECTOR_SECONDS.stairs;
  return rule.wait + rule.perFloor * Math.abs(floors);
}

// levels: [{ id, ordinal, short, name, grid }] (grid: nav-grid.js, or null when the
//         floor's files are not loaded: such a floor cannot be walked on)
// shafts: groupShafts() of the building's connector points
// The start and the destination are anchors:
//   { level, point: [lon, lat], cell, label, via?: [lon, lat] }
// `cell` is the walkable cell the place is reached from (a room: the cell at its
// door; a point: the cell it stands on) and `point` the place itself.
export function createBuildingRouter({ key, levels, shafts }) {
  const levelById = new Map(levels.map((level) => [level.id, level]));

  // Graph nodes: 0 start, 1 destination, then one per shaft member on a loaded floor.
  function route(from, to, { stepFree = false } = {}) {
    const start = levelById.get(from?.level), end = levelById.get(to?.level);
    if (!start?.grid || !end?.grid) return { ok: false, reason: "floor-not-loaded" };
    if (!start.grid.isWalkable(from.cell) || !end.grid.isWalkable(to.cell)) return { ok: false, reason: "not-reachable" };
    const nodes = [{ kind: "start", level: start, cell: from.cell }, { kind: "end", level: end, cell: to.cell }];
    for (const shaft of shafts) {
      if (stepFree && !CONNECTOR_CLASSES[shaft.class]?.accessible) continue;
      for (const [levelId, member] of shaft.members) {
        const level = levelById.get(levelId);
        if (!level?.grid) continue;
        const snapped = level.grid.nearestCell(member.point, 6);
        if (snapped) nodes.push({ kind: "connector", level, cell: snapped.cell, shaft, member });
      }
    }
    const time = new Array(nodes.length).fill(Infinity);
    const previous = new Array(nodes.length).fill(-1);
    const done = new Array(nodes.length).fill(false);
    time[0] = 0;
    for (;;) {
      let current = -1;
      for (let i = 0; i < nodes.length; i += 1) if (!done[i] && (current < 0 || time[i] < time[current])) current = i;
      if (current < 0 || !Number.isFinite(time[current]) || current === 1) break;
      done[current] = true;
      const node = nodes[current];
      for (let i = 0; i < nodes.length; i += 1) {
        if (done[i] || i === current) continue;
        const other = nodes[i];
        let seconds = Infinity;
        if (node.kind === "connector" && other.kind === "connector" && node.shaft === other.shaft) {
          seconds = connectorSeconds(node.shaft.class, other.level.ordinal - node.level.ordinal);
        } else if (other.level === node.level) {
          seconds = node.level.grid.cost(node.cell, other.cell) / WALK_SPEED_MPS;
        }
        if (time[current] + seconds < time[i]) { time[i] = time[current] + seconds; previous[i] = current; }
      }
    }
    if (!Number.isFinite(time[1])) {
      const sameFloor = start === end;
      return { ok: false, reason: sameFloor ? "not-connected" : shafts.length ? "no-connector-route" : "no-connector" };
    }
    const order = [];
    for (let i = 1; i !== -1; i = previous[i]) order.push(i);
    order.reverse();

    const legs = [];
    for (let k = 1; k < order.length; k += 1) {
      const a = nodes[order[k - 1]], b = nodes[order[k]];
      if (a.kind === "connector" && b.kind === "connector" && a.shaft === b.shaft && a.level !== b.level) {
        const floors = b.level.ordinal - a.level.ordinal;
        legs.push({
          type: "connector",
          building: key,
          class: a.shaft.class,
          name: a.member.name || a.shaft.name || CONNECTOR_CLASSES[a.shaft.class].label,
          fromLevel: a.level.id,
          toLevel: b.level.id,
          floors: Math.abs(floors),
          direction: floors > 0 ? "up" : "down",
          point: a.member.point,
          toPoint: b.member.point,
          seconds: connectorSeconds(a.shaft.class, floors)
        });
        continue;
      }
      const found = a.level.grid.path(a.cell, b.cell);
      if (!found) return { ok: false, reason: "not-connected" };
      const coordinates = [...found.coordinates];
      // The first and last steps reach the places themselves (the room's label
      // point, the lift's position), which are not on the grid.
      const head = a.kind === "start" ? [from.via, from.point] : [a.member.point];
      const tail = b.kind === "end" ? [to.via, to.point] : [b.member.point];
      for (const point of head.filter(Boolean)) coordinates.unshift(point);
      for (const point of tail.filter(Boolean)) coordinates.push(point);
      let distanceM = 0;
      for (let i = 1; i < coordinates.length; i += 1) distanceM += planarDistanceMeters(coordinates[i - 1], coordinates[i]);
      legs.push({
        type: "walk",
        building: key,
        level: a.level.id,
        coordinates,
        distanceM,
        seconds: distanceM / WALK_SPEED_MPS,
        from: a.kind === "start" ? from.label : a.member.name || CONNECTOR_CLASSES[a.shaft.class].label,
        to: b.kind === "end" ? to.label : b.member.name || CONNECTOR_CLASSES[b.shaft.class].label,
        toConnector: b.kind === "connector" ? b.shaft.class : null
      });
    }
    return {
      ok: true,
      legs,
      distanceM: legs.reduce((sum, leg) => sum + (leg.distanceM || 0), 0),
      seconds: legs.reduce((sum, leg) => sum + leg.seconds, 0),
      floorChanges: legs.filter((leg) => leg.type === "connector").length
    };
  }

  return { route, levels, shafts };
}
