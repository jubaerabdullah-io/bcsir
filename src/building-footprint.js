// Placement of a building GLB derived from its BuildingBoundary footprint.
//
// Used at runtime (building-models.js) and by the model builder
// (scripts/build-building-models.mjs), so a generated GLB is modelled on exactly
// the rectangle the map fits it to. Pure module, tested with node --test.
//
// - The footprint is the minimum-area rectangle around the polygon's outer ring
//   (one side is collinear with a convex-hull edge), measured in metres in a
//   local frame at the polygon's centre.
// - The front is the rectangle side nearest the building's entrance
//   (entrance_coords); without an entrance, the first long side.
// - GLB convention (models3d.js): +X east, -Z north, Y up; rotation turns the
//   model clockwise seen from above. The model's front faces +Z, i.e. south at
//   rotation 0, so rotation = front bearing - 180.
import { createLocalFrame, geometryPolygons, normalizeDegrees } from "./navigation/local-frame.js";

const DEG = Math.PI / 180;

function outerRing(geometry) {
  let best = null;
  let bestArea = -1;
  for (const rings of geometryPolygons(geometry)) {
    const ring = rings?.[0];
    if (!Array.isArray(ring) || ring.length < 4) continue;
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    if (Math.abs(area) > bestArea) { bestArea = Math.abs(area); best = ring; }
  }
  return best;
}

// Convex hull (monotone chain) of 2D points, counter-clockwise.
function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (const p of sorted.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// The building whose name_en_short is `shortName` (case and spaces ignored), or null.
export function findBuildingByShortName(collection, shortName) {
  const wanted = String(shortName || "").trim().toUpperCase();
  if (!wanted) return null;
  return (collection?.features || []).find((feature) => String(feature?.properties?.name_en_short ?? "").trim().toUpperCase() === wanted) || null;
}

// Compass bearing (degrees) of a local direction vector [east, north].
const bearingOfVector = (v) => normalizeDegrees(Math.atan2(v[0], v[1]) / DEG);

// Minimum-area rectangle around a building footprint, or null.
// Returns { frame, center: [lon, lat], centerLocal, u, v, length, width, corners }:
// u is the long axis (unit vector, metres east/north), v = u turned 90°
// anticlockwise; length is measured along u, width along v; corners [lon, lat]
// go anticlockwise from the -u/-v corner.
export function orientedFootprint(feature) {
  const ring = outerRing(feature?.geometry);
  if (!ring) return null;
  const points = ring.slice(0, -1);
  const origin = points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length], [0, 0]);
  const frame = createLocalFrame(origin);
  const hull = convexHull(points.map(frame.toLocal));
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const edge = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (edge < 1e-9) continue;
    const u = [(b[0] - a[0]) / edge, (b[1] - a[1]) / edge];
    const v = [-u[1], u[0]];
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const pu = p[0] * u[0] + p[1] * u[1], pv = p[0] * v[0] + p[1] * v[1];
      minU = Math.min(minU, pu); maxU = Math.max(maxU, pu); minV = Math.min(minV, pv); maxV = Math.max(maxV, pv);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area - 1e-9) best = { area, u, v, minU, maxU, minV, maxV };
  }
  // Long axis first.
  let { u, v, minU, maxU, minV, maxV } = best;
  if (maxV - minV > maxU - minU) {
    [u, v] = [v, [-v[1], v[0]]];
    [minU, maxU, minV, maxV] = [minV, maxV, -maxU, -minU];
  }
  const at = (pu, pv) => [u[0] * pu + v[0] * pv, u[1] * pu + v[1] * pv];
  const centerLocal = at((minU + maxU) / 2, (minV + maxV) / 2);
  return {
    frame,
    center: frame.toLngLat(centerLocal),
    centerLocal,
    u,
    v,
    length: maxU - minU,
    width: maxV - minV,
    corners: [at(minU, minV), at(maxU, minV), at(maxU, maxV), at(minU, maxV)].map(frame.toLngLat)
  };
}

// The rectangle side nearest the entrance point ([lon, lat]) and the placement of
// a model whose front faces +Z. Returns { side, bearing, frontWidth, depth,
// entranceOffset, rotation, entranceDistance }: bearing is the front's outward
// direction; frontWidth its length; depth the extent behind it; entranceOffset
// the entrance position along the front from its middle, metres to the right
// seen from outside (+X in the model); rotation the models3d.js yaw.
export function footprintFront(footprint, entrance = null) {
  const { u, v, length, width, frame, centerLocal } = footprint;
  // along: the direction to the right of a viewer outside facing that side.
  const sides = [
    { side: "+u", normal: u, along: v, halfDepth: length / 2, frontWidth: width, depth: length },
    { side: "-u", normal: [-u[0], -u[1]], along: [-v[0], -v[1]], halfDepth: length / 2, frontWidth: width, depth: length },
    { side: "+v", normal: v, along: [-u[0], -u[1]], halfDepth: width / 2, frontWidth: length, depth: width },
    { side: "-v", normal: [-v[0], -v[1]], along: u, halfDepth: width / 2, frontWidth: length, depth: width }
  ];
  let chosen = sides[2];
  let entranceOffset = 0;
  let entranceDistance = null;
  if (Array.isArray(entrance) && entrance.length >= 2 && entrance.every(Number.isFinite)) {
    const p = frame.toLocal(entrance);
    const d = [p[0] - centerLocal[0], p[1] - centerLocal[1]];
    let bestGap = Infinity;
    for (const side of sides) {
      // Distance from the entrance to that side (segment of the rectangle).
      const out = d[0] * side.normal[0] + d[1] * side.normal[1] - side.halfDepth;
      const pos = d[0] * side.along[0] + d[1] * side.along[1];
      const beyond = Math.max(0, Math.abs(pos) - side.frontWidth / 2);
      const gap = Math.hypot(out, beyond);
      if (gap < bestGap) { bestGap = gap; chosen = side; entranceOffset = Math.max(-side.frontWidth / 2, Math.min(side.frontWidth / 2, pos)); entranceDistance = gap; }
    }
  }
  const bearing = bearingOfVector(chosen.normal);
  return {
    side: chosen.side,
    bearing,
    frontWidth: chosen.frontWidth,
    depth: chosen.depth,
    entranceOffset,
    entranceDistance,
    rotation: normalizeDegrees(bearing - 180)
  };
}

const finite = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
const MODEL_FILE = /\.(glb|gltf)(?:[?#].*)?$/i;

// Placement of the GLB named by a building's `building_model` property, fitted to
// its footprint (models3d.js stretches the model to `fit`), or null when the
// feature has no valid building_model or footprint:
//   model_rotation  degrees, clockwise seen from above. Whole quarter turns choose
//                   another side as the front (the model is fitted to that side);
//                   the rest turns the fitted model.
//   model_size      multiplier after fitting (1 = the footprint exactly, 1.1 = 10 % larger).
//   base_m / top_m  bottom and top of the model (render_base_m / render_top_m when
//                   prepared by bcsir-data.js); the model height fits top_m - base_m.
// Returns { model, anchor, rotation, fit: [width, height, depth], base, size,
// frontBearing, entranceOffset, quarter, footprint, front }; fit[1] is null when
// the building has no height (the model keeps its proportions).
export function buildingModelPlacement(feature) {
  const p = feature?.properties || {};
  const model = typeof p.building_model === "string" ? p.building_model.trim() : "";
  if (!MODEL_FILE.test(model)) return null;
  const footprint = orientedFootprint(feature);
  if (!footprint) return null;
  const front = footprintFront(footprint, p.entrance_coords);
  const turn = finite(p.model_rotation) ?? 0;
  const quarter = ((Math.round(turn / 90) % 4) + 4) % 4;
  const swap = quarter % 2 === 1;
  const base = finite(p.render_base_m ?? p.base_m) ?? 0;
  const top = finite(p.render_top_m ?? p.top_m);
  const size = finite(p.model_size);
  return {
    model,
    anchor: footprint.center,
    rotation: normalizeDegrees(front.rotation + turn),
    fit: [swap ? front.depth : front.frontWidth, top !== null && top > base ? top - base : null, swap ? front.frontWidth : front.depth],
    base,
    size: size !== null && size > 0 ? size : 1,
    frontBearing: normalizeDegrees(front.bearing + 90 * quarter),
    entranceOffset: quarter === 0 ? front.entranceOffset : 0,
    quarter,
    footprint,
    front
  };
}

// The point `metres` from `origin` ([lon, lat]) towards compass `bearing`.
export function offsetLngLat(origin, bearing, metres) {
  const frame = createLocalFrame(origin);
  return frame.toLngLat([Math.sin(bearing * DEG) * metres, Math.cos(bearing * DEG) * metres]);
}

// Corners [lon, lat] of a model's horizontal bounding box (GLB metres: x from
// minX to maxX, z from minZ to maxZ) placed at `anchor` with `rotation` and
// uniform `scale`, for the debug outline.
export function placedBoxCorners({ anchor, rotation, scale = 1, minX, maxX, minZ, maxZ }) {
  const frame = createLocalFrame(anchor);
  const yaw = rotation * DEG;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const toWorld = ([x, z]) => {
    const lx = (x - cx) * scale, lz = (z - cz) * scale;
    return frame.toLngLat([lx * Math.cos(yaw) - lz * Math.sin(yaw), -(lx * Math.sin(yaw) + lz * Math.cos(yaw))]);
  };
  return [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]].map(toWorld);
}
