#!/usr/bin/env node
// Pre-processes every organisation's GeoJSON datasets into tile-ready files
// with all render_* properties baked in and derived geometry (lineStrips,
// roofSeams, verticalCorners) materialised as real features.
//
// Output: one directory per org under <outDir>/<org>/ with ND-GeoJSON files
// (one feature per line) that tippecanoe reads directly:
//
//   campus-ground.geojson.nl  — area, boundary, internal, roads, pathways merged
//   buildings.geojson.nl      — building polygons
//   building-seams.geojson.nl — roof seam strips
//   building-corners.geojson.nl — corner column squares
//   garden.geojson.nl         — garden polygons
//   building-labels.geojson.nl — label points
//
// Usage:
//   node scripts/build-tiles.mjs [--out <dir>]
//
// The output is consumed by tippecanoe in CI:
//   tippecanoe -o dist/data/<org>/tiles.pmtiles \
//     --force -z20 -Z12 -r1 -an \
//     --no-feature-limit --no-tile-size-limit \
//     -L campus-ground:<out>/<org>/campus-ground.geojson.nl \
//     -L buildings:<out>/<org>/buildings.geojson.nl \
//     ...
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// These imports use the same source files the browser app uses, so the
// properties and derived geometry are identical.
import { DATASET_KEYS } from "../src/core/config.js";
import { buildingLabelPoints, prepareDataset } from "../src/data/bcsir-data.js";
import { lineStrips, roofSeams, verticalCorners } from "../src/utils/geo-utils.js";
import { listOrganisations, buildOrgIndex } from "./lib/catalog.mjs";

const EMPTY = { type: "FeatureCollection", features: [] };

// Ground datasets merged into one "campus-ground" source, same as bcsir-layers.js.
const GROUND_KEYS = ["area", "boundary", "internal", "roads", "roadsDrawing", "pathways"];
const polygonsOnly = (collection) => ({
  ...collection,
  features: collection.features.filter(
    (f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon"
  )
});

function tagged(name, collection) {
  return collection.features.map((f) => ({
    ...f,
    properties: { ...f.properties, render_part: name }
  }));
}

function buildCampusGround(render) {
  return {
    type: "FeatureCollection",
    features: [
      ...tagged("area", render.area || EMPTY),
      ...tagged("boundary", polygonsOnly(render.boundary || EMPTY)),
      ...tagged("boundary-wall", lineStrips(render.boundary || EMPTY)),
      ...tagged("internal-wall", lineStrips(render.internal || EMPTY)),
      ...tagged("roads-drawing", lineStrips(render.roadsDrawing || EMPTY)),
      ...tagged("pathway", lineStrips(render.pathways || EMPTY)),
      ...tagged("road", lineStrips(render.roads || EMPTY))
    ]
  };
}

// Write ND-GeoJSON (newline-delimited): one JSON feature per line.
// tippecanoe reads this with -L name:file.geojson.nl
function writeNDGeoJSON(filePath, collection) {
  const lines = collection.features.map((f) => JSON.stringify(f));
  writeFileSync(filePath, lines.join("\n") + "\n");
  return collection.features.length;
}

function loadDataset(orgDir, key, orgIndex) {
  const fileName = orgIndex?.datasets?.[key];
  if (!fileName) return null;
  const filePath = path.join(orgDir, fileName);
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    if (data?.type !== "FeatureCollection") return null;
    return data;
  } catch { return null; }
}

function processOrg(orgId, outDir) {
  const orgDir = path.join(root, "public", "data", orgId);
  const orgIndex = buildOrgIndex(root, orgId);
  const orgOut = path.join(outDir, orgId);
  mkdirSync(orgOut, { recursive: true });

  // Load and normalise every dataset.
  const render = {};
  for (const key of DATASET_KEYS) {
    const raw = loadDataset(orgDir, key, orgIndex);
    if (!raw) {
      render[key] = EMPTY;
      continue;
    }
    render[key] = prepareDataset(key, raw);
  }

  const stats = {};

  // 1. Campus ground (merged source).
  const ground = buildCampusGround(render);
  stats["campus-ground"] = writeNDGeoJSON(path.join(orgOut, "campus-ground.geojson.nl"), ground);

  // 2. Buildings.
  stats.buildings = writeNDGeoJSON(path.join(orgOut, "buildings.geojson.nl"), render.buildings);

  // 3. Building seams and corners (derived geometry).
  const seams = roofSeams(render.buildings);
  stats["building-seams"] = writeNDGeoJSON(path.join(orgOut, "building-seams.geojson.nl"), seams);
  const corners = verticalCorners(render.buildings);
  stats["building-corners"] = writeNDGeoJSON(path.join(orgOut, "building-corners.geojson.nl"), corners);

  // 4. Garden.
  stats.garden = writeNDGeoJSON(path.join(orgOut, "garden.geojson.nl"), render.garden);

  // 5. Building labels (points).
  const labels = buildingLabelPoints(render.buildings);
  stats["building-labels"] = writeNDGeoJSON(path.join(orgOut, "building-labels.geojson.nl"), labels);

  return stats;
}

// --- Main ---
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 && args[outIdx + 1] ? path.resolve(args[outIdx + 1]) : path.join(root, "dist", "tiles-staging");

console.log(`Vector tile pre-processing → ${outDir}`);
const orgs = listOrganisations(root);
for (const orgId of orgs) {
  const stats = processOrg(orgId, outDir);
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  console.log(`  ${orgId}: ${total} features (${Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join(", ")})`);
}
console.log("Done. Run tippecanoe on these files to produce .pmtiles.");
