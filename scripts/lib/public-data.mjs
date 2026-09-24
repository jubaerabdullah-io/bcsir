// Keeps public/data/ complete.
//
// public/data/ is the single home of the BCSIR datasets. The GeoJSON layers
// (BCSIRBoundary, BuildingBoundary, ConnectedRoad, ConnectedRoadsDrawingVersion,
// Pathway, InternalBoundary) and the routing network ConnectedRoads/v0/r2.json
// are edited there directly; the QGIS project opens them from there. Their
// former duplicates in the repository root were removed on 2026-09-24; the
// original geometry and attributes are fingerprinted in
// original-data-fingerprints.json and checked by npm test.
//
// This module still converts the two shapefile layers (ShapefileFolder/Garden
// and ShapefileFolder/TreeLine, the QGIS sources of those layers) into
// public/data/Garden.geojson and TreeLine.geojson, keeping every feature, its
// geometry and attributes and adding the visualization properties described in
// README.md. Shapefile coordinates are binary doubles, written with
// JavaScript's exact round-trip format. It also creates the empty GLB placement
// files when they are missing.
//
// Modes
//   default     create files that do not exist yet; never touch existing ones
//   --refresh   rebuild Garden.geojson and TreeLine.geojson from the shapefiles,
//               KEEPING the visualization properties already set in them (use
//               after editing a shapefile in QGIS)
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readShapefile } from "./shapefile-reader.mjs";

// Properties that belong to the visualization copies (kept on --refresh).
export const VISUAL_KEYS = ["base_m", "top_m", "thickness_m", "color", "fill_color", "spacing_m", "image", "model", "model_points", "size", "scale", "rotation", "surface_model", "surface_scale"];

// The GeoJSON datasets that live only in public/data/ (edited there directly).
export const PUBLIC_DATASETS = [
  { name: "BCSIRBoundary", target: "public/data/BCSIRBoundary.geojson" },
  { name: "BuildingBoundary", target: "public/data/BuildingBoundary.geojson" },
  { name: "ConnectedRoad", target: "public/data/ConnectedRoad.geojson" },
  { name: "ConnectedRoadsDrawingVersion", target: "public/data/ConnectedRoadsDrawingVersion.geojson" },
  { name: "Pathway", target: "public/data/Pathway.geojson" },
  { name: "InternalBoundary", target: "public/data/InternalBoundary.geojson" }
];

// The routing network (never modified; its sha256 is in original-files.sha256).
export const ROUTING_NETWORK = "public/data/ConnectedRoads/v0/r2.json";

// Datasets converted from the shapefiles, with their initial visualization values.
export const DATASETS = [
  { name: "Garden", shapefile: "ShapefileFolder/Garden/Garden", target: "public/data/Garden.geojson",
    defaults: () => ({ base_m: 0, top_m: 0.03, color: "#CDEBB0" }) },
  { name: "TreeLine", shapefile: "ShapefileFolder/TreeLine/TreeLine", target: "public/data/TreeLine.geojson",
    defaults: () => ({ base_m: 0, top_m: 7.5, color: "#3F8F3A", spacing_m: 7 }) }
];

// Point files for GLB placements; created empty if missing, never overwritten.
export const MODEL_FILES = [
  "public/data/models.geojson",
  "public/data/GardenModels.geojson",
  "public/data/TreeLineModels.geojson"
];

const CRS84 = { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } };

// ---- Minimal JSON scanner returning source spans ------------------------------
function scanValue(text, i) {
  const skip = (at) => { while (at < text.length && /\s/.test(text[at])) at += 1; return at; };
  i = skip(i);
  const start = i;
  const char = text[i];
  if (char === "{") {
    const members = [];
    i = skip(i + 1);
    if (text[i] === "}") return { start, end: i + 1, members };
    for (;;) {
      const key = scanValue(text, i);
      i = skip(key.end);
      if (text[i] !== ":") throw new Error(`Expected ':' at ${i}`);
      const value = scanValue(text, i + 1);
      members.push({ key: JSON.parse(text.slice(key.start, key.end)), value });
      i = skip(value.end);
      if (text[i] === ",") { i += 1; continue; }
      if (text[i] === "}") return { start, end: i + 1, members };
      throw new Error(`Expected ',' or '}' at ${i}`);
    }
  }
  if (char === "[") {
    const items = [];
    i = skip(i + 1);
    if (text[i] === "]") return { start, end: i + 1, items };
    for (;;) {
      const value = scanValue(text, i);
      items.push(value);
      i = skip(value.end);
      if (text[i] === ",") { i += 1; continue; }
      if (text[i] === "]") return { start, end: i + 1, items };
      throw new Error(`Expected ',' or ']' at ${i}`);
    }
  }
  if (char === '"') {
    for (i += 1; i < text.length; i += 1) {
      if (text[i] === "\\") { i += 1; continue; }
      if (text[i] === '"') return { start, end: i + 1 };
    }
    throw new Error("Unterminated string");
  }
  const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
  if (!match) throw new Error(`Unexpected token at ${i}`);
  return { start, end: i + match[0].length };
}

const minify = (raw) => raw.replace(/("(?:[^"\\]|\\.)*")|\s+/g, (_, string) => string || "");

// Raw geometry text of every feature, in order (whitespace removed outside strings).
export function rawGeometries(text) {
  const root = scanValue(text, 0);
  const features = root.members?.find((member) => member.key === "features")?.value;
  if (!features?.items) throw new Error("Not a GeoJSON FeatureCollection");
  return features.items.map((feature) => {
    const geometry = feature.members?.find((member) => member.key === "geometry")?.value;
    return geometry ? minify(text.slice(geometry.start, geometry.end)) : "null";
  });
}

// ---- Writing ---------------------------------------------------------------------
const propertiesText = (properties) => `{ ${Object.entries(properties).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(", ")} }`;

function collectionText({ name, crs, features }) {
  const lines = features.map(({ properties, geometryText, id }) => `{ "type": "Feature", ${id !== undefined ? `"id": ${JSON.stringify(id)}, ` : ""}"properties": ${propertiesText(properties)}, "geometry": ${geometryText} }`);
  return `{\n"type": "FeatureCollection",\n"name": ${JSON.stringify(name)},\n"crs": ${JSON.stringify(crs || CRS84)},\n"features": [\n${lines.join(",\n")}\n]\n}\n`;
}

async function readOriginal(root, dataset) {
  const shapefile = await readShapefile(path.join(root, dataset.shapefile));
  if (!/GEOGCS\["GCS_WGS_1984"/.test(shapefile.prj)) throw new Error(`${dataset.shapefile}.prj is not WGS 84; refusing to guess a reprojection.`);
  return {
    name: dataset.name,
    crs: CRS84,
    features: shapefile.features.map((feature) => ({ properties: feature.properties, geometryText: JSON.stringify(feature.geometry), geometry: feature.geometry }))
  };
}

// Match copy features to original features by unique `id`, else by position.
function matchExisting(originalFeatures, existing) {
  const byId = new Map();
  const counts = new Map();
  existing.features.forEach((feature) => {
    const id = feature.properties?.id;
    if (id === undefined || id === null) return;
    counts.set(id, (counts.get(id) || 0) + 1);
    byId.set(id, feature);
  });
  const used = new Set();
  const matches = originalFeatures.map((feature, index) => {
    const id = feature.properties?.id;
    let match = id !== undefined && id !== null && counts.get(id) === 1 ? byId.get(id) : null;
    if (!match && existing.features[index] && !used.has(existing.features[index])) match = existing.features[index];
    if (match) used.add(match);
    return match || null;
  });
  const extras = existing.features.filter((feature) => !used.has(feature));
  return { matches, extras };
}

export async function buildCopy(root, dataset, existingText = null) {
  const original = await readOriginal(root, dataset);
  const existing = existingText ? JSON.parse(existingText) : null;
  const existingGeometry = existingText ? rawGeometries(existingText) : [];
  const { matches, extras } = existing ? matchExisting(original.features, existing) : { matches: [], extras: [] };
  const features = original.features.map((feature, index) => {
    const properties = { ...feature.properties };
    const defaults = dataset.defaults(feature.properties);
    for (const [key, value] of Object.entries(defaults)) if (!(key in properties)) properties[key] = value;
    const kept = matches[index]?.properties || {};
    for (const key of VISUAL_KEYS) if (key in kept) properties[key] = kept[key];
    return { id: feature.id, properties, geometryText: feature.geometryText };
  });
  // Features added only to the copy (e.g. Point features carrying a `model`) are kept.
  extras.forEach((feature) => {
    const index = existing.features.indexOf(feature);
    features.push({ id: feature.id, properties: feature.properties || {}, geometryText: existingGeometry[index] });
  });
  return collectionText({ name: original.name, crs: original.crs, features });
}

export async function preparePublicData(root, { refresh = false, log = () => {} } = {}) {
  const written = [];
  for (const dataset of DATASETS) {
    const target = path.join(root, dataset.target);
    const exists = existsSync(target);
    if (exists && !refresh) continue;
    const text = await buildCopy(root, dataset, exists ? await readFile(target, "utf8") : null);
    if (exists && text === await readFile(target, "utf8")) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
    written.push(dataset.target);
    log(`${exists ? "Refreshed" : "Created"} ${dataset.target}`);
  }
  for (const dataset of PUBLIC_DATASETS) {
    if (!existsSync(path.join(root, dataset.target))) log(`Missing ${dataset.target}: restore it from backup/ or from version control.`);
  }
  if (!existsSync(path.join(root, ROUTING_NETWORK))) log(`Missing ${ROUTING_NETWORK}: routes cannot be calculated. Restore it from backup/ or from version control.`);
  for (const file of MODEL_FILES) {
    const target = path.join(root, file);
    if (existsSync(target)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `{\n"type": "FeatureCollection",\n"name": ${JSON.stringify(path.basename(file, ".geojson"))},\n"crs": ${JSON.stringify(CRS84)},\n"features": [\n]\n}\n`, "utf8");
    written.push(file);
    log(`Created ${file} (empty)`);
  }
  return written;
}
