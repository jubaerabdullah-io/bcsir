// Footprint polygon helpers for the styles built along a building's own edges
// (gallery, modern). Points are model XZ metres (see mesh.mjs).
import { edgeFrame } from "./mesh.mjs";

export const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];

export function inside(point, pts) {
  let result = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > point[1]) !== (zj > point[1]) && point[0] < (xj - xi) * (point[1] - zi) / (zj - zi) + xi) result = !result;
  }
  return result;
}

export function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}

// Edge lies along another part's edge (parallel, within 0.8 m, mostly overlapping).
function sharedWith(edge, [P, Q]) {
  const s = [Q[0] - P[0], Q[1] - P[1]], ls = Math.hypot(...s);
  if (ls < 0.5) return false;
  const u = [s[0] / ls, s[1] / ls], e = [(edge.B[0] - edge.A[0]) / edge.L, (edge.B[1] - edge.A[1]) / edge.L];
  if (Math.abs(cross2(u, e)) > 0.1) return false;
  const off = (p) => Math.abs((p[0] - P[0]) * u[1] - (p[1] - P[1]) * u[0]);
  if (off(edge.A) > 0.8 || off(edge.B) > 0.8) return false;
  const tA = (edge.A[0] - P[0]) * u[0] + (edge.A[1] - P[1]) * u[1], tB = (edge.B[0] - P[0]) * u[0] + (edge.B[1] - P[1]) * u[1];
  return Math.min(Math.max(tA, tB), ls) - Math.max(Math.min(tA, tB), 0) > 0.6 * edge.L;
}

// Does the ray origin + t * dir (0 < t <= reach) cross one of the segments?
function rayHits(origin, dir, segments, reach) {
  for (const [P, Q] of segments) {
    const s = [Q[0] - P[0], Q[1] - P[1]];
    const den = cross2(dir, s);
    if (Math.abs(den) < 1e-9) continue;
    const w = [P[0] - origin[0], P[1] - origin[1]];
    const t = cross2(w, s) / den, u = cross2(w, dir) / den;
    if (t > 0 && t <= reach && u >= 0 && u <= 1) return true;
  }
  return false;
}

// Edges of the footprint (counter-clockwise in x, z: outside is on the right):
// { A, B, L, n (outward), frame (mesh edgeFrame: a = 0 at B), convexEnd (at B),
// kind }. kind: "shared" (along a neighbouring modelled part: no wall), "inner"
// (it faces the building's own walls or a connected part's, as round a courtyard)
// or "outer". neighbours: [{ segments: [[P, Q], ...] }] of the other modelled parts.
export function polygonEdges(polygon, { neighbours = [], reach = 80 } = {}) {
  let pts = polygon.slice();
  const area = pts.reduce((sum, p, i) => sum + cross2(p, pts[(i + 1) % pts.length]), 0) / 2;
  if (area < 0) pts = pts.reverse();
  const edges = pts.map((A, i) => {
    const B = pts[(i + 1) % pts.length];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const n = [(B[1] - A[1]) / L, -(B[0] - A[0]) / L];
    return { A, B, L, n, frame: edgeFrame(A, B, n) };
  });
  const partners = neighbours.filter((neighbour) => neighbour.segments.some((segment) => edges.some((edge) => sharedWith(edge, segment))));
  edges.forEach((edge, i) => {
    const next = edges[(i + 1) % edges.length];
    edge.convexEnd = cross2([edge.B[0] - edge.A[0], edge.B[1] - edge.A[1]], [next.B[0] - next.A[0], next.B[1] - next.A[1]]) > 0;
    if (neighbours.some((neighbour) => neighbour.segments.some((segment) => sharedWith(edge, segment)))) { edge.kind = "shared"; return; }
    const origin = [(edge.A[0] + edge.B[0]) / 2 + edge.n[0] * 0.3, (edge.A[1] + edge.B[1]) / 2 + edge.n[1] * 0.3];
    const own = edges.filter((other) => other !== edge).map((other) => [other.A, other.B]);
    const blockers = own.concat(partners.flatMap((partner) => partner.segments));
    edge.kind = rayHits(origin, edge.n, blockers, reach) ? "inner" : "outer";
  });
  return { pts, edges };
}

// Point inside the polygon farthest from its edges (roof structures): { x, z, clearance }.
export function interiorPoint(pts, edges, step = 1) {
  const clearance = (p) => Math.min(...edges.map((edge) => segmentDistance(p, edge.A, edge.B)));
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  let best = null;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) for (let z = Math.min(...zs); z <= Math.max(...zs); z += step) {
    if (!inside([x, z], pts)) continue;
    const c = clearance([x, z]);
    if (!best || c > best.clearance) best = { x, z, clearance: c };
  }
  return best;
}

// Compass bearing (degrees) of a model-frame horizontal direction [x, z] once placed.
export function worldBearing(n, rotation) {
  const t = rotation * Math.PI / 180;
  const east = n[0] * Math.cos(t) - n[1] * Math.sin(t), north = -(n[0] * Math.sin(t) + n[1] * Math.cos(t));
  return ((Math.atan2(east, north) * 180 / Math.PI) + 360) % 360;
}

// The outer edge nearest a point and the point's position along it (frame a).
export function nearestEdge(point, edges, kinds = ["outer"]) {
  let best = null;
  for (const edge of edges.filter((item) => kinds.includes(item.kind))) {
    const d = segmentDistance(point, edge.A, edge.B);
    if (best && d >= best.d) continue;
    const origin = edge.frame.at(0, 0, 0);
    best = { d, edge, a: (point[0] - origin[0]) * edge.frame.right[0] + (point[1] - origin[2]) * edge.frame.right[2] };
  }
  return best;
}
