#!/usr/bin/env node
// Usage: npm run models:buildings                    build every model in scripts/building-models/specs.mjs
//        npm run models:buildings -- IGCRT 127       only these (name or BuildingBoundary id)
//
// Builds realistic, web-light GLB models of BCSIR buildings (in place of Blender
// exports; same rules: origin at the footprint centre on the ground, 1 unit = 1 m,
// transforms applied, outward normals, one mesh, one material, textures packed).
// Each model is built on its building's footprint from BuildingBoundary.geojson
// (src/building-footprint.js, the code the map places it with): the front
// (entrance side, or the side chosen by model_rotation) faces +Z and is the
// footprint's width, the depth follows, the height is top_m - base_m. Thousands
// of small details (screen openings, window panes) are texture, not geometry: one
// 1024 px WebP atlas per model, painted procedurally and from the reference photos
// in backup/models/source/. The scene extras record the footprint box, so parts
// that reach beyond the footprint (a canopy, steps) do not change the fit.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildingModelPlacement } from "../src/building-footprint.js";
import { createAtlas } from "./building-models/atlas.mjs";
import { createMesh } from "./building-models/mesh.mjs";
import { BUILDING_SPECS } from "./building-models/specs.mjs";
import * as screen from "./building-models/style-screen.mjs";
import * as grid from "./building-models/style-grid.mjs";
import * as gallery from "./building-models/style-gallery.mjs";
import * as tank from "./building-models/style-tank.mjs";
import * as gate from "./building-models/style-gate.mjs";
import * as modern from "./building-models/style-modern.mjs";
import * as brick from "./building-models/style-brick.mjs";
import * as classic from "./building-models/style-classic.mjs";
import * as mosque from "./building-models/style-mosque.mjs";
import * as residential from "./building-models/style-residential.mjs";

const STYLES = { screen, grid, gallery, tank, gate, modern, brick, classic, mosque, residential };
const root = fileURLToPath(new URL("..", import.meta.url));
const PHOTOS = path.join(root, "backup/models/source");
const buildings = JSON.parse(await readFile(path.join(root, "public/data/BuildingBoundary.geojson"), "utf8"));
const campus = JSON.parse(await readFile(path.join(root, "public/data/BCSIRBoundary.geojson"), "utf8"));
const wanted = process.argv.slice(2).map((value) => value.trim().toUpperCase()).filter(Boolean);

const outerRing = (feature) => (feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates[0][0] : feature.geometry.coordinates[0]);
// [lon, lat] -> model XZ (metres) for a placement: the inverse of the map's placement.
function modelFrame(placement) {
  const { frame, centerLocal } = placement.footprint;
  const t = placement.rotation * Math.PI / 180;
  return (point) => {
    const [x, y] = frame.toLocal(point);
    const east = x - centerLocal[0], north = y - centerLocal[1];
    return [east * Math.cos(t) - north * Math.sin(t), -(east * Math.sin(t) + north * Math.cos(t))];
  };
}
function insideRings(point, rings) {
  let result = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > point[1]) !== (zj > point[1]) && point[0] < (xj - xi) * (point[1] - zi) / (zj - zi) + xi) result = !result;
  }
  return result;
}
const campusRings = campus.features.flatMap((feature) => (feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates.flat() : feature.geometry.type === "Polygon" ? feature.geometry.coordinates : []));

// A module (spec.module: one bay of one floor, tiled by the map over every building
// whose building_model names it) is built on its own box, not on a footprint. Its
// shading is baked for the front facing module.front, where the map turns it.
async function buildModule(spec, style) {
  const { bay: W, depth: D, floor: H, front = 180 } = spec.module;
  const rotation = front - 180;
  const ctx = { W, D, H, spec, feature: null, rotation, entranceOffset: 0, polygon: [[-W / 2, D / 2], [W / 2, D / 2], [W / 2, -D / 2], [-W / 2, -D / 2]], neighbours: [], photo: (file) => path.join(PHOTOS, file) };
  const atlas = createAtlas();
  await style.paint(atlas, ctx);
  const mesh = createMesh({ regions: style.regions, swatches: style.swatches, W, D, rotation });
  const info = style.build(mesh, ctx);
  const result = await mesh.write(path.join(root, "public", spec.file), {
    atlas: await atlas.encode(),
    footprint: { min: [-W / 2, 0, -D / 2], max: [W / 2, H, D / 2] },
    name: spec.name,
    cutout: atlas.hasAlpha()
  });
  const users = buildings.features.filter((feature) => feature.properties?.building_model === spec.file);
  console.log(`${spec.name} (module, ${spec.style}): ${info?.module ?? `${W} x ${D} x ${H} m`}, front faces ${front}°`);
  console.log(`  wrote public/${spec.file}: ${result.triangles} triangles, ${result.vertices} vertices, 1 material, ${(result.bytes / 1024).toFixed(0)} KB`);
  console.log(`  used by ${users.length} building${users.length === 1 ? "" : "s"}${users.length ? `: ${users.map((feature) => feature.properties.id).join(", ")}` : `; set "building_model": "${spec.file}" on buildings in BuildingBoundary.geojson`}`);
}

let built = 0;
for (const spec of BUILDING_SPECS) {
  if (wanted.length && !wanted.includes(spec.name.toUpperCase()) && !wanted.includes(String(spec.id))) continue;
  if (spec.module) {
    if (!STYLES[spec.style]) throw new Error(`${spec.name}: unknown style "${spec.style}"`);
    await buildModule(spec, STYLES[spec.style]);
    built += 1;
    continue;
  }
  const feature = buildings.features.find((item) => item.properties?.id === spec.id);
  if (!feature) { console.warn(`${spec.name}: no BuildingBoundary feature with id ${spec.id}; skipped.`); continue; }
  const style = STYLES[spec.style];
  if (!style) throw new Error(`${spec.name}: unknown style "${spec.style}"`);
  // The placement the map will compute for this building and file.
  const placement = buildingModelPlacement({ ...feature, properties: { ...feature.properties, building_model: spec.file } });
  if (!placement) { console.warn(`${spec.name}: the footprint has no polygon; skipped.`); continue; }
  const [W, height, D] = placement.fit;
  const H = height ?? 10;
  const toModel = modelFrame(placement);
  // The other modelled parts (walls along their edges are left out) and the campus boundary.
  const neighbours = BUILDING_SPECS.filter((other) => other !== spec && !other.module).map((other) => buildings.features.find((item) => item.properties?.id === other.id)).filter(Boolean)
    .map((other) => { const ring = outerRing(other).map(toModel); return { id: other.properties.id, segments: ring.slice(1).map((point, i) => [ring[i], point]) }; });
  const boundaryRings = campusRings.map((ring) => ring.map(toModel));
  const ctx = {
    W, D, H, spec, feature,
    entranceOffset: placement.entranceOffset,
    rotation: placement.rotation,
    polygon: outerRing(feature).slice(0, -1).map(toModel),
    neighbours,
    entrance: spec.entrance ? toModel(spec.entrance) : null,
    entranceCoords: Array.isArray(feature.properties.entrance_coords) && feature.properties.entrance_coords.length >= 2 ? toModel(feature.properties.entrance_coords) : null,
    boundaryRings,
    insideCampus: (point) => insideRings(point, boundaryRings),
    photo: (file) => path.join(PHOTOS, file)
  };
  const atlas = createAtlas();
  await style.paint(atlas, ctx);
  const mesh = createMesh({ regions: style.regions, swatches: style.swatches, W, D, rotation: placement.rotation });
  const info = style.build(mesh, ctx);
  const result = await mesh.write(path.join(root, "public", spec.file), {
    atlas: await atlas.encode(),
    footprint: { min: [-W / 2, 0, -D / 2], max: [W / 2, H, D / 2] },
    name: spec.name,
    cutout: atlas.hasAlpha()
  });
  if (info?.edges) console.log(`  walls: ${["outer", "inner", "shared"].map((kind) => `${info.edges.filter((item) => item === kind).length} ${kind}`).join(", ")}`);
  if (info?.facades) console.log(`  facades (from the front, clockwise seen from above): ${info.facades.join(", ")}`);
  if (info?.distance !== undefined) console.log(`  on the boundary wall ${info.distance.toFixed(2)} m from the marker, turned ${(info.angle * 180 / Math.PI).toFixed(1)}° in the model`);
  built += 1;
  console.log(`${spec.name} (building ${spec.id}, ${spec.style}): ${W.toFixed(2)} m front x ${D.toFixed(2)} m deep x ${H} m, front faces ${placement.frontBearing.toFixed(1)}°`);
  console.log(`  wrote public/${spec.file}: ${result.triangles} triangles, ${result.vertices} vertices, 1 material, ${(result.bytes / 1024).toFixed(0)} KB`);
  if (feature.properties.building_model !== spec.file) console.log(`  not used yet: set "building_model": "${spec.file}" on building ${spec.id} in BuildingBoundary.geojson`);
}
if (!built) console.warn(`No model built. Known: ${BUILDING_SPECS.map((spec) => `${spec.name} (${spec.id})`).join(", ")}`);
