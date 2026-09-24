// public/data keeps the original data exactly, and the visualization
// properties are read, validated and turned into render geometry correctly.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DATASETS, MODEL_FILES, PUBLIC_DATASETS, ROUTING_NETWORK, rawGeometries, VISUAL_KEYS } from "../scripts/lib/public-data.mjs";
import { readShapefile } from "../scripts/lib/shapefile-reader.mjs";
import { buildingLabelPoints, normalizeBuildings, prepareDataset } from "../src/bcsir-data.js";
import { distanceMeters, lineStrips } from "../src/geo-utils.js";
import { LAYER_DEFAULTS } from "../src/config.js";
import { parseColor, resolveVisual } from "../src/visual-properties.js";
import { collectModelPlacements } from "../src/model-placements.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8");
const readJSON = (file) => JSON.parse(read(file));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const DATASET_KEYS = { BCSIRBoundary: "boundary", BuildingBoundary: "buildings", ConnectedRoad: "roads", ConnectedRoadsDrawingVersion: "roadsDrawing", Pathway: "pathways", InternalBoundary: "internal", Garden: "garden", TreeLine: "treeLine" };
const fingerprints = readJSON("original-data-fingerprints.json").datasets;

// The GeoJSON layers live only in public/data/. Their original geometry text and
// attribute values were fingerprinted before the root duplicates were removed.
for (const dataset of PUBLIC_DATASETS) {
  test(`${dataset.name} in public/data keeps every original feature, geometry text, ID and attribute`, () => {
    const fingerprint = fingerprints[dataset.name];
    const text = read(dataset.target);
    const copy = JSON.parse(text);
    const geometries = rawGeometries(text);
    assert.equal(copy.type, "FeatureCollection");
    assert.ok(copy.features.length >= fingerprint.features.length, "no original feature removed");
    fingerprint.features.forEach((original, index) => {
      const properties = copy.features[index].properties || {};
      assert.equal(properties.id ?? null, original.id, `${dataset.name} feature ${index} id`);
      // Coordinates are not even re-formatted: the numeric text is identical.
      assert.equal(sha256(geometries[index]), original.geometry, `${dataset.name} feature ${index} (id ${original.id}) geometry`);
      assert.equal(sha256(JSON.stringify(fingerprint.attribute_keys.map((key) => [key, properties[key]]))), original.attributes, `${dataset.name} feature ${index} (id ${original.id}) original attributes`);
    });
    assert.ok(fingerprint.attribute_keys.every((key) => !VISUAL_KEYS.includes(key)), "visualization properties stay editable");
  });
}

// Garden and TreeLine are converted from the shapefiles, which remain the source.
for (const dataset of DATASETS) {
  test(`public copy of ${dataset.name} keeps every shapefile feature, geometry, ID and attribute`, async () => {
    const original = (await readShapefile(path.join(root, dataset.shapefile))).features;
    const copy = readJSON(dataset.target);
    assert.equal(copy.type, "FeatureCollection");
    assert.ok(copy.features.length >= original.length);
    original.forEach((feature, index) => {
      const copied = copy.features[index];
      assert.deepEqual(copied.geometry, feature.geometry, `geometry of feature ${index}`);
      for (const [key, value] of Object.entries(feature.properties || {})) {
        if (VISUAL_KEYS.includes(key)) continue;
        assert.deepEqual(copied.properties[key], value, `${dataset.name} feature ${index} attribute ${key}`);
      }
    });
  });
}

for (const dataset of [...PUBLIC_DATASETS, ...DATASETS]) {

  test(`${dataset.name} visualization properties are all valid`, () => {
    const problems = [];
    const report = { add: (id, message) => problems.push(`${id}: ${message}`) };
    const key = DATASET_KEYS[dataset.name];
    readJSON(dataset.target).features.forEach((feature, index) => {
      const p = feature.properties;
      for (const field of ["base_m", "top_m", "color"]) assert.ok(field in p, `${dataset.name} feature ${index} has ${field}`);
      resolveVisual(p, LAYER_DEFAULTS[key], { report, featureId: p.id ?? index, legacyColorCodes: key === "buildings" });
    });
    assert.deepEqual(problems, []);
  });
}

test("routing network is the original r2.json and model files exist", () => {
  const recorded = read("original-files.sha256").split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find(([, file]) => file === ROUTING_NETWORK)?.[0];
  assert.equal(createHash("sha256").update(readFileSync(path.join(root, ROUTING_NETWORK))).digest("hex"), recorded);
  for (const file of MODEL_FILES) assert.equal(readJSON(file).type, "FeatureCollection", file);
});

test("each dataset exists once: no duplicate data files outside public/data", () => {
  for (const { name } of PUBLIC_DATASETS) assert.throws(() => readFileSync(path.join(root, `${name}.geojson`)), `${name}.geojson should only be in public/data/`);
  assert.throws(() => readFileSync(path.join(root, "ConnectedRoads/v0/r2.json")), "the routing network should only be in public/data/");
});

// Photos from the original map (map-bcsir.srcdrive.com/images/) keep their file
// name "<building id>.jpg", which is that building's original image_url.
test("each building photo in public/image belongs to the building with its ID", () => {
  const buildings = readJSON("public/data/BuildingBoundary.geojson").features.map((feature) => feature.properties);
  const photos = readdirSync(path.join(root, "public/image")).filter((file) => /^\d+\.jpg$/.test(file));
  assert.ok(photos.length > 0, "building photos present");
  for (const file of photos) {
    const owners = buildings.filter((building) => building.image_url === file);
    assert.equal(owners.length, 1, `${file} is the image_url of exactly one building`);
    assert.equal(`${owners[0].id}.jpg`, file, `${file} belongs to building ${owners[0].id}`);
    assert.equal(readFileSync(path.join(root, "public/image", file)).subarray(0, 3).toString("hex"), "ffd8ff", `${file} is a JPEG`);
  }
});

test("r2.json is exactly ConnectedRoad.geojson plus Pathway.geojson", () => {
  const key = (feature) => JSON.stringify(feature.geometry.coordinates);
  const network = new Set(readJSON("public/data/ConnectedRoads/v0/r2.json").features.map(key));
  const roads = readJSON("public/data/ConnectedRoad.geojson").features;
  const pathways = readJSON("public/data/Pathway.geojson").features;
  assert.equal(network.size, roads.length + pathways.length);
  assert.ok([...roads, ...pathways].every((feature) => network.has(key(feature))));
});

test("parseColor accepts hex colours only", () => {
  assert.equal(parseColor("#FF0000"), "#ff0000");
  assert.equal(parseColor("#f00"), "#ff0000");
  assert.equal(parseColor("87CEEB"), "#87ceeb");
  for (const bad of ["red", "#12345", "#GGGGGG", "", null, 12]) assert.equal(parseColor(bad), null, String(bad));
});

test("buildings take base_m, top_m and color from GeoJSON", () => {
  const raw = readJSON("public/data/BuildingBoundary.geojson");
  const snapshot = JSON.stringify(raw);
  const edit = (id, props) => ({ ...raw, features: raw.features.map((feature) => (feature.properties.id === id ? { ...feature, properties: { ...feature.properties, ...props } } : feature)) });
  const building = (collection, id) => normalizeBuildings(collection).features.find((feature) => feature.properties.id === id).properties;

  const current = building(raw, 102);
  assert.equal(current.render_base_m, 0);
  assert.equal(current.render_top_m, 12);
  assert.equal(current.render_color, "#d9d0c9", "legacy code \"o\" keeps the QGIS office colour");
  assert.equal(building(raw, 207).render_color, "#ff9a87", "hex colour set by the owner");

  const changed = building(edit(102, { base_m: 5, top_m: 25, color: "#FF0000" }), 102);
  assert.deepEqual([changed.render_base_m, changed.render_top_m, changed.render_color], [5, 25, "#ff0000"]);
  const numericStrings = building(edit(102, { base_m: "2", top_m: "8.5" }), 102);
  assert.deepEqual([numericStrings.render_base_m, numericStrings.render_top_m], [2, 8.5]);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const invalid = building(edit(102, { top_m: -1, color: "blue" }), 102);
    assert.deepEqual([invalid.render_top_m, invalid.render_color], [LAYER_DEFAULTS.buildings.top_m, LAYER_DEFAULTS.buildings.color.toLowerCase()]);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1, "one grouped warning for the file");
  assert.match(warnings[0], /top_m must be greater than base_m/);
  assert.match(warnings[0], /color must be a hex colour/);

  assert.equal(JSON.stringify(raw), snapshot, "source data not mutated");
  const rendered = normalizeBuildings(raw);
  rendered.features.forEach((feature, index) => assert.equal(feature.geometry, raw.features[index].geometry, "geometry object passed through"));
  assert.equal(buildingLabelPoints(rendered).features.length, rendered.features.length);
});

test("road, pathway and boundary strips follow thickness_m, base_m, top_m and color", () => {
  const raw = readJSON("public/data/ConnectedRoad.geojson");
  const road = raw.features[1]; // a straight 3-vertex road
  const centreline = JSON.stringify(road.geometry);
  const withProps = (props) => prepareDataset("roads", { type: "FeatureCollection", features: [{ ...road, properties: { ...road.properties, ...props } }] });
  for (const thickness of [0.5, 2.5, 6]) {
    const strip = lineStrips(withProps({ thickness_m: thickness, base_m: 1, top_m: 1.5, color: "#59636D" })).features[0];
    const ring = strip.geometry.coordinates[0];
    // Opposite corners at the middle vertex are one road width apart.
    const half = (ring.length - 1) / 2;
    const width = distanceMeters(ring[1], ring[ring.length - 3]);
    assert.ok(Math.abs(width - thickness) / thickness < 0.02, `strip width ${width.toFixed(3)} m for thickness_m ${thickness} (${half} vertices per side)`);
    assert.deepEqual([strip.properties.render_base_m, strip.properties.render_top_m, strip.properties.render_color], [1, 1.5, "#59636d"]);
  }
  assert.equal(JSON.stringify(road.geometry), centreline, "centreline untouched");
  assert.equal(sha256(rawGeometries(read("public/data/ConnectedRoad.geojson"))[1]), fingerprints.ConnectedRoad.features[1].geometry, "centreline is the original");

  const walls = lineStrips(prepareDataset("boundary", readJSON("public/data/BCSIRBoundary.geojson")));
  assert.equal(walls.features.length, 1);
  assert.equal(walls.features[0].geometry.coordinates.length, 2, "closed boundary ring becomes a band with a hole");
  assert.equal(lineStrips(prepareDataset("internal", readJSON("public/data/InternalBoundary.geojson"))).features.length, 6);
});

test("GLB placements come only from Point, MultiPoint or explicit model_points", () => {
  const point = (coordinates, props, type = "Point") => ({ type: "Feature", properties: props, geometry: { type, coordinates } });
  const { collection, problems } = collectModelPlacements([{ label: "test", collection: { type: "FeatureCollection", features: [
    point([90.386, 23.7403], { id: "a", model: "/models/escalators.glb", base_m: 0.5, top_m: 3, size: 0, rotation: 280 }),
    point([[90.3861, 23.7404], [90.3862, 23.7405]], { id: "b", model: "/models/tree.glb" }, "MultiPoint"),
    { type: "Feature", properties: { id: "c", model: "/models/tree.glb", model_points: [[90.3863, 23.7406]] }, geometry: { type: "Polygon", coordinates: [[[90.38, 23.74], [90.381, 23.74], [90.381, 23.741], [90.38, 23.74]]] } },
    { type: "Feature", properties: { id: "d", model: "/models/tree.glb" }, geometry: { type: "LineString", coordinates: [[90.38, 23.74], [90.381, 23.741]] } },
    point([90.386, 23.7403], { id: "e", model: "/models/picture.png" }),
    point([90.386, 23.7403], { id: "f", name: "no model" })
  ] } }]);
  assert.deepEqual(collection.features.map((f) => f.properties.id), ["test-a", "test-b-1", "test-b-2", "test-c"]);
  assert.deepEqual(collection.features[0].properties, { id: "test-a", name: null, model: "/models/escalators.glb", base_m: 0.5, top_m: 3, size: 0, scale: 1, rotation: 280 });
  assert.deepEqual(collection.features[3].geometry.coordinates, [90.3863, 23.7406]);
  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /LineString needs "model_points"/);
  assert.match(problems.join("\n"), /\.glb or \.gltf/);
});
