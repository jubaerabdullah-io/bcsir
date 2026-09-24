// Drawn route geometry that does not pass through buildings.
//
// Routes are calculated with the original BCSIR algorithm on the original
// network (routing/route-service.js); that is not changed here. Two parts of
// the drawn route can still cross a building footprint:
// - one network edge of r2.json clips a corner of building 126;
// - the dashed access legs are straight lines from a building's entrance (or,
//   without a recorded entrance, its centre) to the nearest network node, and
//   some of them cross neighbouring buildings.
// No building has indoor map data, so none of these crossings is a real
// passage. correctRouteResult() returns a copy of a route result whose DRAWN
// geometry goes around such buildings, along their outline at a small
// clearance. The node path (`path`) and the endpoints stay exactly as the
// original algorithm returned them. A leg may enter its own endpoint building
// (the destination is that building). Pure module, tested with node --test.
import { closestOnSegment, createLocalFrame, distance, geometryPolygons, insideRings, polylineLength, ringsBounds, segmentIntersection } from "./local-frame.js";

const MIN_CROSSING_M = 0.25; // shorter overlaps are digitising noise at a wall
const CLEARANCE_M = 1.2;

// Buildings as obstacles, in a local metric frame. `blocks(feature)` decides
// which footprints are solid (default: all).
export function prepareObstacles(buildings, { frame, blocks = () => true } = {}) {
  const features = buildings?.features || [];
  const first = features.find((feature) => geometryPolygons(feature.geometry).length);
  const localFrame = frame || (first ? createLocalFrame(geometryPolygons(first.geometry)[0][0][0]) : createLocalFrame([0, 0]));
  const obstacles = [];
  features.forEach((feature) => {
    if (!blocks(feature)) return;
    const p = feature.properties || {};
    geometryPolygons(feature.geometry).forEach((rings) => {
      const outer = (rings?.[0] || []).map(localFrame.toLocal);
      if (outer.length < 4) return;
      const ring = outer.slice(0, -1); // open ring, closing vertex removed
      let area = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      obstacles.push({ id: String(p.render_id ?? p.id), name: String(p.name_en || p.render_label || p.id || "").trim(), ring, closed: outer, ccw: area > 0, bounds: ringsBounds([outer]) });
    });
  });
  return { frame: localFrame, obstacles };
}

function boundsOverlap(bounds, a, b, margin = 0) {
  return Math.max(a[0], b[0]) >= bounds[0] - margin && Math.min(a[0], b[0]) <= bounds[2] + margin
    && Math.max(a[1], b[1]) >= bounds[1] - margin && Math.min(a[1], b[1]) <= bounds[3] + margin;
}

// Length (m) of segment a-b inside an obstacle's outer ring.
export function insideLength(a, b, obstacle) {
  if (!boundsOverlap(obstacle.bounds, a, b)) return 0;
  const ts = [0, 1];
  const ring = obstacle.closed;
  for (let i = 1; i < ring.length; i += 1) {
    const hit = segmentIntersection(a, b, ring[i - 1], ring[i]);
    if (hit) ts.push(hit.t);
  }
  ts.sort((x, y) => x - y);
  const length = distance(a, b);
  let inside = 0;
  for (let i = 1; i < ts.length; i += 1) {
    const t0 = ts[i - 1], t1 = ts[i];
    if (t1 - t0 < 1e-9) continue;
    const mid = (t0 + t1) / 2;
    if (insideRings([a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid], [ring])) inside += (t1 - t0) * length;
  }
  return inside;
}

function distanceToRing(point, obstacle) {
  let best = Infinity;
  const ring = obstacle.closed;
  for (let i = 1; i < ring.length; i += 1) best = Math.min(best, closestOnSegment(point, ring[i - 1], ring[i]).distance);
  return best;
}

// Outline pushed outward by `clearance` metres (mitred, mitre length capped).
function offsetRing(obstacle, clearance) {
  obstacle.offsets ||= new Map();
  if (obstacle.offsets.has(clearance)) return obstacle.offsets.get(clearance);
  const { ring, ccw } = obstacle;
  const n = ring.length;
  const normal = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
    return ccw ? [dy / length, -dx / length] : [-dy / length, dx / length];
  };
  const offset = ring.map((vertex, i) => {
    const n1 = normal(ring[(i - 1 + n) % n], vertex);
    const n2 = normal(vertex, ring[(i + 1) % n]);
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const length = Math.hypot(mx, my);
    if (length < 1e-6) { mx = n1[0]; my = n1[1]; } else { mx /= length; my /= length; }
    const cos = Math.max(0.34, mx * n1[0] + my * n1[1]); // cap the mitre at ~3x
    return [vertex[0] + mx * clearance / cos, vertex[1] + my * clearance / cos];
  });
  obstacle.offsets.set(clearance, offset);
  return offset;
}

const crosses = (a, b, obstacles) => obstacles.some((obstacle) => insideLength(a, b, obstacle) > MIN_CROSSING_M);
const insideAny = (point, obstacles) => obstacles.some((obstacle) => point[0] >= obstacle.bounds[0] && point[0] <= obstacle.bounds[2] && point[1] >= obstacle.bounds[1] && point[1] <= obstacle.bounds[3] && insideRings(point, [obstacle.closed]));

// Shortest walk from a to b around the obstacles near them: A* over a
// visibility graph whose nodes are the building outlines pushed out by the
// clearance. Touching buildings are passed around as one block. Null if a or
// b is inside an obstacle or no way round is found.
function shortestAround(a, b, obstacles, margin) {
  const lo = [Math.min(a[0], b[0]) - margin, Math.min(a[1], b[1]) - margin];
  const hi = [Math.max(a[0], b[0]) + margin, Math.max(a[1], b[1]) + margin];
  const nearby = obstacles.filter((obstacle) => obstacle.bounds[2] >= lo[0] && obstacle.bounds[0] <= hi[0] && obstacle.bounds[3] >= lo[1] && obstacle.bounds[1] <= hi[1]);
  if (insideAny(a, nearby) || insideAny(b, nearby)) return null;
  const clearance = Math.max(0.2, Math.min(CLEARANCE_M, ...nearby.map((obstacle) => Math.min(0.8 * distanceToRing(a, obstacle), 0.8 * distanceToRing(b, obstacle)))));
  const nodes = [a, b];
  nearby.forEach((obstacle) => offsetRing(obstacle, clearance).forEach((point) => {
    if (point[0] >= lo[0] && point[0] <= hi[0] && point[1] >= lo[1] && point[1] <= hi[1] && !insideAny(point, nearby)) nodes.push(point);
  }));
  const cost = new Array(nodes.length).fill(Infinity);
  const previous = new Array(nodes.length).fill(-1);
  const done = new Array(nodes.length).fill(false);
  cost[0] = 0;
  for (;;) {
    let current = -1, best = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      if (done[i] || cost[i] === Infinity) continue;
      const estimate = cost[i] + distance(nodes[i], b);
      if (estimate < best) { best = estimate; current = i; }
    }
    if (current < 0) return null;
    if (current === 1) break;
    done[current] = true;
    for (let next = 0; next < nodes.length; next += 1) {
      if (done[next] || next === current) continue;
      const candidate = cost[current] + distance(nodes[current], nodes[next]);
      if (candidate >= cost[next] || crosses(nodes[current], nodes[next], nearby)) continue;
      cost[next] = candidate;
      previous[next] = current;
    }
  }
  const path = [];
  for (let i = 1; i !== -1; i = previous[i]) path.unshift(nodes[i]);
  return path;
}

// coordinates: [[lon, lat], ...]. ignore: ids of obstacles the path may enter.
// Returns { coordinates, detours: [{ id, name }], unresolved: [{ id, name }] }.
// Unchanged paths keep their original coordinate array.
export function detourPath(coordinates, prepared, { ignore = new Set() } = {}) {
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !prepared?.obstacles?.length) return { coordinates: coordinates || [], detours: [], unresolved: [] };
  const { frame } = prepared;
  const skip = new Set([...ignore].map(String));
  const active = prepared.obstacles.filter((obstacle) => !skip.has(obstacle.id));
  const points = coordinates.map(frame.toLocal);
  const output = [points[0]];
  const detours = [];
  const unresolved = [];
  const note = (list, obstacle) => { if (!list.some((item) => item.id === obstacle.id)) list.push({ id: obstacle.id, name: obstacle.name }); };
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const crossed = active.filter((obstacle) => insideLength(a, b, obstacle) > MIN_CROSSING_M);
    let replacement = null;
    if (crossed.length) {
      for (const margin of [40, 120]) {
        replacement = shortestAround(a, b, active, margin);
        if (replacement) break;
      }
    }
    if (replacement) {
      output.push(...replacement.slice(1));
      crossed.forEach((obstacle) => note(detours, obstacle));
    } else {
      output.push(b);
      crossed.forEach((obstacle) => note(unresolved, obstacle));
    }
  }
  if (!detours.length) return { coordinates, detours, unresolved };
  return { coordinates: output.filter((point, i) => i === 0 || distance(output[i - 1], point) > 0.01).map(frame.toLngLat), detours, unresolved };
}

// Copy of a route-service result with drawn geometry around buildings:
// - coordinates / networkDistanceM: the network part (node path unchanged);
// - source.accessPath / destination.accessPath: entrance (or centre) -> node.
// originalCoordinates keeps the unmodified network geometry.
export function correctRouteResult(result, prepared) {
  if (!result?.source || !result?.destination || !prepared) return result;
  const idOf = (endpoint) => String(endpoint?.feature?.properties?.render_id ?? endpoint?.feature?.properties?.id ?? "");
  const detours = [];
  const unresolved = [];
  const collect = (outcome) => {
    outcome.detours.forEach((item) => { if (!detours.some((known) => known.id === item.id)) detours.push(item); });
    outcome.unresolved.forEach((item) => { if (!unresolved.some((known) => known.id === item.id)) unresolved.push(item); });
    return outcome.coordinates;
  };
  const access = (endpoint) => {
    if (!endpoint?.point || !endpoint.nodeCoordinates) return null;
    if (!(endpoint.snapDistanceM > 0.05)) return [endpoint.point, endpoint.nodeCoordinates];
    return collect(detourPath([endpoint.point, endpoint.nodeCoordinates], prepared, { ignore: new Set([idOf(endpoint)]) }));
  };
  const source = { ...result.source, accessPath: access(result.source) };
  const destination = { ...result.destination, accessPath: access(result.destination) };
  if (!result.ok || !Array.isArray(result.coordinates) || result.coordinates.length < 2) {
    return { ...result, source, destination, detours, unresolved };
  }
  const network = collect(detourPath(result.coordinates, prepared));
  const { frame } = prepared;
  // The route service measures with the haversine formula; a detour adds its
  // extra length (local metric frame) to that figure.
  const extraM = network === result.coordinates ? 0 : polylineLength(network.map(frame.toLocal)) - polylineLength(result.coordinates.map(frame.toLocal));
  return {
    ...result,
    originalCoordinates: result.coordinates,
    coordinates: network,
    networkDistanceM: result.networkDistanceM + extraM,
    source,
    destination,
    detours,
    unresolved
  };
}
