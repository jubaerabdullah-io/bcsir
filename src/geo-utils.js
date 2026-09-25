// Geometry helpers reused from the reference indoor-mapping project
// (src/indoor-base.js and src/indoor-redesign.js). Function bodies are kept
// as in the reference; the "shop" helpers are generalised to any polygon layer.
//
// All output here is derived, in-memory RENDER geometry (roof seams, corner
// columns, wall strips). The source GeoJSON is never modified.

import { wallStrip } from "./wall-strip.js";

const MX = 111320;
const MY = 110574;
const number = (value) => { const result = Number(value); return Number.isFinite(result) ? result : NaN; };
const project = ([lon, lat], lat0) => [lon * MX * Math.cos(lat0 * Math.PI / 180), lat * MY];
const unproject = ([x, y], lat0) => [x / (MX * Math.cos(lat0 * Math.PI / 180)), y / MY];

// ---- from src/indoor-base.js -------------------------------------------------
function visit(coordinates, bounds) { if (!Array.isArray(coordinates)) return; if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") { bounds.extend(coordinates); return; } coordinates.forEach((item) => visit(item, bounds)); }
export function calculateBounds(collection, LngLatBounds) { const bounds = new LngLatBounds(); collection.features.forEach((feature) => visit(feature.geometry.coordinates, bounds)); return bounds; }
export function getFeatureCenter(feature) { const points = []; const collect = (coordinates) => { if (!Array.isArray(coordinates)) return; if (typeof coordinates[0] === "number") points.push(coordinates); else coordinates.forEach(collect); }; collect(feature.geometry.coordinates); if (!points.length) return null; const sum = points.reduce((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0]); return [sum[0] / points.length, sum[1] / points.length]; }

// ---- from src/indoor-redesign.js ---------------------------------------------
function intersection(a1, a2, b1, b2) {
  const ax = a2[0] - a1[0], ay = a2[1] - a1[1], bx = b2[0] - b1[0], by = b2[1] - b1[1];
  const denominator = ax * by - ay * bx;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((b1[0] - a1[0]) * by - (b1[1] - a1[1]) * bx) / denominator;
  return [a1[0] + t * ax, a1[1] + t * ay];
}

function offsetSegment(a, b, distance) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  if (!length) return null;
  const nx = -dy / length * distance, ny = dx / length * distance;
  return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny]];
}

function offsetPath(points, distance) {
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) { const segment = offsetSegment(points[i], points[i + 1], distance); if (segment) segments.push(segment); }
  if (!segments.length) return [];
  const result = [segments[0][0]];
  for (let i = 1; i < segments.length; i += 1) {
    const crossing = intersection(segments[i - 1][0], segments[i - 1][1], segments[i][0], segments[i][1]);
    const vertex = points[i], limit = Math.max(Math.abs(distance) * 4, .01);
    result.push(crossing && Math.hypot(crossing[0] - vertex[0], crossing[1] - vertex[1]) <= limit ? crossing : [(segments[i - 1][1][0] + segments[i][0][0]) / 2, (segments[i - 1][1][1] + segments[i][0][1]) / 2]);
  }
  result.push(segments.at(-1)[1]);
  return result;
}

function extendEnds(points, distance) {
  if (points.length < 2 || distance <= 0 || (points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1])) return points;
  const output = points.map((point) => [...point]);
  const start = [output[1][0] - output[0][0], output[1][1] - output[0][1]], end = [output.at(-1)[0] - output.at(-2)[0], output.at(-1)[1] - output.at(-2)[1]];
  const startLength = Math.hypot(...start), endLength = Math.hypot(...end);
  if (startLength) { output[0][0] -= start[0] / startLength * distance; output[0][1] -= start[1] / startLength * distance; }
  if (endLength) { output.at(-1)[0] += end[0] / endLength * distance; output.at(-1)[1] += end[1] / endLength * distance; }
  return output;
}

// Reference signature was (path, thickness, alignment, level); BCSIR only uses
// the centred alignment, which does not need the level polygon.
export function wallLineToPolygon(path, thickness, alignment = "center") {
  if (!Array.isArray(path) || path.length < 2 || path.some((point) => !Array.isArray(point) || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1])))) return null;
  if (alignment !== "center") throw new Error("Only centred wall alignment is supported in the BCSIR map.");
  const lat0 = path.reduce((sum, point) => sum + Number(point[1]), 0) / path.length;
  const metric = extendEnds(path.map((point) => project(point, lat0)), thickness / 2);
  const left = offsetPath(metric, thickness / 2);
  const right = offsetPath(metric, -thickness / 2);
  if (!left.length || !right.length) return null;
  return { type: "Polygon", coordinates: [[...left, ...right.reverse(), left[0]].map((point) => unproject(point, lat0))] };
}

// Reference: shopTopSeams(). A thin cap that traces each footprint at roof height.
export function roofSeams(collection, { thickness = 0.12, color = "#59636D" } = {}) {
  const features = [];
  collection.features.forEach((feature, featureIndex) => {
    const geometry = feature?.geometry;
    const properties = feature?.properties || {};
    if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return;
    const topM = number(properties.render_top_m);
    if (!Number.isFinite(topM)) return;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach((rings, polygonIndex) => {
      rings.forEach((ring, ringIndex) => {
        if (!Array.isArray(ring) || ring.length < 4) return;
        const path = ring.map((point) => [Number(point[0]), Number(point[1])]);
        if (path.some((point) => !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return;
        const seamGeometry = wallLineToPolygon(path, thickness, "center");
        if (!seamGeometry) return;
        const id = `${properties.render_id || properties.id || `feature_${featureIndex + 1}`}__roof_seam_${polygonIndex}_${ringIndex}`;
        features.push({
          type: "Feature",
          id,
          properties: { render_id: id, parent_id: properties.render_id, render_color: color, render_base_m: topM + 0.02, render_top_m: topM + 0.1 },
          geometry: seamGeometry
        });
      });
    });
  });
  return { type: "FeatureCollection", features };
}

function cornerSquare(point, widthM = 0.055) {
  const lon = Number(point?.[0]), lat = Number(point?.[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const [x, y] = project([lon, lat], lat);
  const half = widthM / 2;
  const ring = [
    [x - half, y - half],
    [x + half, y - half],
    [x + half, y + half],
    [x - half, y + half],
    [x - half, y - half]
  ].map((coordinate) => unproject(coordinate, lat));
  return { type: "Polygon", coordinates: [ring] };
}

// Reference: shopVerticalCorners(). Narrow columns define vertical edges; shared
// vertices are deduplicated to avoid dark stacking.
export function verticalCorners(collection, { width = 0.14, color = "#4B5563" } = {}) {
  const corners = new Map();
  collection.features.forEach((feature) => {
    const geometry = feature?.geometry;
    const properties = feature?.properties || {};
    if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return;
    const baseM = number(properties.render_base_m);
    const topM = number(properties.render_top_m);
    if (!Number.isFinite(baseM) || !Number.isFinite(topM) || topM - baseM < 1) return;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach((rings) => {
      const exterior = rings?.[0];
      if (!Array.isArray(exterior) || exterior.length < 4) return;
      exterior.slice(0, -1).forEach((point) => {
        const lon = Number(point?.[0]), lat = Number(point?.[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        const key = `${lon.toFixed(9)}:${lat.toFixed(9)}`;
        const existing = corners.get(key);
        if (existing) {
          existing.baseM = Math.min(existing.baseM, baseM);
          existing.topM = Math.max(existing.topM, topM);
        } else {
          corners.set(key, { point: [lon, lat], baseM, topM, parent: properties.render_id });
        }
      });
    });
  });
  const features = [];
  let index = 0;
  corners.forEach(({ point, baseM, topM, parent }) => {
    const geometry = cornerSquare(point, width);
    if (!geometry) return;
    const id = `vertical_corner_${index += 1}`;
    features.push({ type: "Feature", id, properties: { render_id: id, parent_id: parent, render_color: color, render_base_m: baseM + 0.01, render_top_m: topM + 0.08 }, geometry });
  });
  return { type: "FeatureCollection", features };
}

// Metric distance between two lon/lat points (haversine). Display only.
export function distanceMeters(a, b) {
  const R = 6371008.8;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Polygon label point: area-weighted centroid of the largest outer ring,
// falling back to the vertex average from getFeatureCenter().
export function polygonCentroid(feature) {
  const geometry = feature?.geometry;
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return getFeatureCenter(feature);
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  for (const rings of polygons) {
    const ring = rings?.[0];
    if (!Array.isArray(ring) || ring.length < 4) continue;
    // Work relative to the first vertex: with raw lon/lat (~90, ~23) the cross
    // products of small footprints cancel catastrophically in double precision.
    const [ox, oy] = ring[0];
    let area = 0, cx = 0, cy = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xj = ring[j][0] - ox, yj = ring[j][1] - oy, xi = ring[i][0] - ox, yi = ring[i][1] - oy;
      const cross = xj * yi - xi * yj;
      area += cross;
      cx += (xj + xi) * cross;
      cy += (yj + yi) * cross;
      minX = Math.min(minX, ring[i][0]); maxX = Math.max(maxX, ring[i][0]);
      minY = Math.min(minY, ring[i][1]); maxY = Math.max(maxY, ring[i][1]);
    }
    if (!area) continue;
    const point = [ox + cx / (3 * area), oy + cy / (3 * area)];
    // Degenerate rings can still produce an outlier; never leave the footprint's bounds.
    if (point[0] < minX || point[0] > maxX || point[1] < minY || point[1] > maxY) continue;
    const candidate = { area: Math.abs(area), point };
    if (!best || candidate.area > best.area) best = candidate;
  }
  return best?.point || getFeatureCenter(feature);
}

// ---- Metric strips for roads and boundaries (BCSIR) ---------------------------------
function pathsOf(geometry) {
  switch (geometry?.type) {
    case "LineString": return [geometry.coordinates];
    case "MultiLineString": return geometry.coordinates;
    case "Polygon": return geometry.coordinates; // every ring, so holes get walls too
    case "MultiPolygon": return geometry.coordinates.flat();
    default: return [];
  }
}

// Metric strips around lines/rings, `render_thickness_m` wide. Open lines use the
// reference wallLineToPolygon() (ends extended by half the width so junctions
// close); closed rings use the reference wallStrip() (a band with a hole).
export function lineStrips(collection) {
  const features = [];
  (collection?.features || []).forEach((feature) => {
    const p = feature.properties;
    pathsOf(feature.geometry).forEach((path, part) => {
      if (!Array.isArray(path) || path.length < 2) return;
      const first = path[0], last = path.at(-1);
      const closed = path.length > 3 && first[0] === last[0] && first[1] === last[1];
      const polygon = closed ? wallStrip(path, p.render_thickness_m, "center") : wallLineToPolygon(path, p.render_thickness_m, "center");
      if (!polygon) return;
      features.push({
        type: "Feature",
        properties: { render_id: `${p.render_id}_${part}`, render_base_m: p.render_base_m, render_top_m: p.render_top_m, render_color: p.render_color },
        geometry: polygon
      });
    });
  });
  return { type: "FeatureCollection", features };
}

// Render copy of a line/polygon collection with openings: for each gap
// { point: [lon, lat], halfWidth: metres }, the stretch of the nearest line (if it
// passes within `reach` metres of the point) that lies within halfWidth along the
// line is removed; the rest stays one open path. Paths without a gap are kept as
// they were (closed rings stay closed), so their strips do not change.
export function cutLineGaps(collection, gaps, reach = 6) {
  if (!gaps?.length) return collection;
  const cutPath = (path, { point, halfWidth }) => {
    const lat0 = point[1];
    const origin = project(point, lat0);
    const local = path.map((p) => { const q = project(p, lat0); return [q[0] - origin[0], q[1] - origin[1]]; });
    const along = [0];
    let best = null;
    for (let i = 1; i < local.length; i += 1) {
      const [a, b] = [local[i - 1], local[i]];
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      along.push(along[i - 1] + length);
      if (!length) continue;
      const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (length * length)));
      const d = Math.hypot(a[0] + dx * t, a[1] + dy * t);
      if (!best || d < best.d) best = { d, s: along[i - 1] + t * length };
    }
    if (!best || best.d > reach) return [path];
    const total = along.at(-1);
    const at = (s) => {
      const i = Math.max(1, along.findIndex((value) => value >= s));
      const t = (s - along[i - 1]) / ((along[i] - along[i - 1]) || 1);
      const a = local[i - 1], b = local[i];
      return unproject([a[0] + (b[0] - a[0]) * t + origin[0], a[1] + (b[1] - a[1]) * t + origin[1]], lat0);
    };
    const piece = (s0, s1) => (s1 - s0 < 0.05 ? [] : [at(s0), ...path.filter((_, i) => along[i] > s0 && along[i] < s1), at(s1)]);
    const [s0, s1] = [best.s - halfWidth, best.s + halfWidth];
    const first = path[0], last = path.at(-1);
    if (path.length > 3 && first[0] === last[0] && first[1] === last[1]) {
      // Ring: one open path from the end of the gap round to its start (the gap may
      // straddle the ring's first point).
      if (2 * halfWidth >= total) return [];
      const start = ((s1 % total) + total) % total, end = start + total - 2 * halfWidth;
      if (end <= total) return [piece(start, end)].filter((p) => p.length >= 2);
      return [[...piece(start, total), ...piece(0, end - total).slice(1)]].filter((p) => p.length >= 2);
    }
    return [piece(0, Math.max(0, s0)), piece(Math.min(total, s1), total)].filter((p) => p.length >= 2);
  };
  return {
    ...collection,
    features: collection.features.map((feature) => {
      const paths = pathsOf(feature.geometry);
      let changed = false;
      const next = paths.flatMap((path) => {
        let pieces = [path];
        for (const gap of gaps) pieces = pieces.flatMap((piece) => cutPath(piece, gap));
        if (pieces.length !== 1 || pieces[0] !== path) changed = true;
        return pieces;
      });
      return changed ? { ...feature, geometry: { type: "MultiLineString", coordinates: next } } : feature;
    })
  };
}

// ---- Label anchors (BCSIR) ------------------------------------------------------------
// Point-in-polygon for one polygon's rings (outer ring + holes), even-odd rule.
export function pointInRings(point, rings) {
  let inside = false;
  for (const ring of rings || []) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// Signed distance (metres, local projection) from a point to the polygon outline;
// positive inside, negative outside.
function signedDistance(point, rings) {
  let min = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      const dx = bx - ax, dy = by - ay;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / length)) : 0;
      min = Math.min(min, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)));
    }
  }
  return (pointInRings(point, rings) ? 1 : -1) * min;
}

// Pole of inaccessibility (the "polylabel" method): the interior point farthest
// from the polygon's edges. Unlike a centroid it is always inside the footprint,
// also for L-, U- and other irregular shapes. Works in metres around the polygon.
function poleOfInaccessibility(rings, precisionM = 0.25) {
  const lat0 = rings[0].reduce((sum, point) => sum + Number(point[1]), 0) / rings[0].length;
  const metric = rings.map((ring) => ring.map((point) => project([Number(point[0]), Number(point[1])], lat0)));
  const xs = metric[0].map((point) => point[0]), ys = metric[0].map((point) => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  const cellSize = Math.min(width, height);
  if (!(cellSize > 0)) return null;
  const cell = (x, y, h) => { const d = signedDistance([x, y], metric); return { x, y, h, d, max: d + h * Math.SQRT2 }; };
  const queue = [];
  for (let x = minX; x < minX + width; x += cellSize) for (let y = minY; y < minY + height; y += cellSize) queue.push(cell(x + cellSize / 2, y + cellSize / 2, cellSize / 2));
  // Start from the area centroid when it lies inside, else the bbox centre.
  let best = cell(minX + width / 2, minY + height / 2, 0);
  let area = 0, cx = 0, cy = 0;
  const outer = metric[0];
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i, i += 1) {
    const cross = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
    area += cross; cx += (outer[j][0] + outer[i][0]) * cross; cy += (outer[j][1] + outer[i][1]) * cross;
  }
  if (area) { const centroid = cell(cx / (3 * area), cy / (3 * area), 0); if (centroid.d > best.d) best = centroid; }
  for (let guard = 0; queue.length && guard < 20000; guard += 1) {
    queue.sort((a, b) => b.max - a.max);
    const current = queue.shift();
    if (current.d > best.d) best = current;
    if (current.max - best.d <= precisionM) continue;
    const h = current.h / 2;
    queue.push(cell(current.x - h, current.y - h, h), cell(current.x + h, current.y - h, h), cell(current.x - h, current.y + h, h), cell(current.x + h, current.y + h, h));
  }
  return best.d > 0 ? unproject([best.x, best.y], lat0) : null;
}

// Label anchor for a building: the pole of inaccessibility of its largest polygon,
// falling back to polygonCentroid(). Geometry is only read, never changed.
// Anchors are kept per geometry object: the label points are rebuilt whenever a
// building photo has loaded, and the search is the same for the same footprint.
const anchorCache = new WeakMap();
export function labelAnchor(feature) {
  const geometry = feature?.geometry;
  if (geometry && typeof geometry === "object") {
    if (!anchorCache.has(geometry)) anchorCache.set(geometry, computeLabelAnchor(feature));
    const anchor = anchorCache.get(geometry);
    return anchor ? [...anchor] : anchor;
  }
  return computeLabelAnchor(feature);
}

function computeLabelAnchor(feature) {
  const geometry = feature?.geometry;
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return polygonCentroid(feature);
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let largest = null, largestArea = -1;
  for (const rings of polygons) {
    const ring = rings?.[0];
    if (!Array.isArray(ring) || ring.length < 4) continue;
    const [ox, oy] = ring[0];
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) area += (ring[j][0] - ox) * (ring[i][1] - oy) - (ring[i][0] - ox) * (ring[j][1] - oy);
    if (Math.abs(area) > largestArea) { largestArea = Math.abs(area); largest = rings; }
  }
  return (largest && poleOfInaccessibility(largest)) || polygonCentroid(feature);
}
