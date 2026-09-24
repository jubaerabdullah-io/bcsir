// Local metric frame and small plane-geometry helpers for navigation, walk
// collision and route correction. Campus-scale only (< a few km): lon/lat are
// mapped to metres east/north of an origin (equirectangular), which is exact to
// well under 0.1 % across the campus. Pure module, tested with node --test.

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

export function createLocalFrame(origin) {
  const [lon0, lat0] = origin;
  const kx = EARTH_RADIUS_M * Math.cos(lat0 * DEG) * DEG;
  const ky = EARTH_RADIUS_M * DEG;
  return {
    origin: [lon0, lat0],
    toLocal: (point) => [(point[0] - lon0) * kx, (point[1] - lat0) * ky],
    toLngLat: (point) => [lon0 + point[0] / kx, lat0 + point[1] / ky]
  };
}

export const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function normalizeDegrees(value) {
  return ((Number(value) || 0) % 360 + 360) % 360;
}

// Signed difference b - a in degrees, in (-180, 180].
export function angleDelta(a, b) {
  const delta = ((b - a) % 360 + 540) % 360 - 180;
  return delta === -180 ? 180 : delta;
}

// Compass bearing (degrees clockwise from north) of the vector a -> b.
export function bearingOf(a, b) {
  return normalizeDegrees(Math.atan2(b[0] - a[0], b[1] - a[1]) / DEG);
}

// Closest point to p on segment a-b: { point, t, distance }.
export function closestOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
  const point = [a[0] + dx * t, a[1] + dy * t];
  return { point, t, distance: distance(p, point) };
}

// Intersection parameters of segments a-b and c-d, or null. t on a-b, u on c-d.
export function segmentIntersection(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denominator;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, point: [a[0] + rx * t, a[1] + ry * t] };
}

// Even-odd point-in-polygon over all rings (outer ring + holes).
export function insideRings(point, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function ringsBounds(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]);
  return total;
}

// Polygon rings of a GeoJSON Polygon/MultiPolygon geometry: one entry per polygon.
export function geometryPolygons(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}
