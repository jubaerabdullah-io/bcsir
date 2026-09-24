// Label anchors, basemaps and the walking-route summary.
import "../scripts/lib/node-routing-hooks.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildingLabelPoints, normalizeBuildings } from "../src/bcsir-data.js";
import { labelAnchor, pointInRings, polygonCentroid } from "../src/geo-utils.js";
import { BASEMAP_SOURCES, BASEMAPS, basemapLayers, basemapVisibility, thumbnailUrl } from "../src/basemaps.js";
import { describeEndpoint, describeRoute, formatDistance, walkingMinutes } from "../src/route-summary.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const readJSON = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const buildings = normalizeBuildings(readJSON("public/data/BuildingBoundary.geojson"));
// Loaded after the routing hook is registered (it resolves "virtual:bcsir-routing").
const { createRouteService } = await import("../src/routing/route-service.js");

test("every building label is anchored inside its own footprint", () => {
  const labels = buildingLabelPoints(buildings);
  assert.equal(labels.features.length, buildings.features.length);
  labels.features.forEach((label, index) => {
    const rings = buildings.features[index].geometry.coordinates[0];
    assert.ok(pointInRings(label.geometry.coordinates, rings), `building ${buildings.features[index].properties.id}`);
    assert.equal(label.properties.render_id, buildings.features[index].properties.render_id);
  });
});

test("irregular footprints: the label stays inside where the centroid falls outside", () => {
  const u = { geometry: { type: "Polygon", coordinates: [[[0, 0], [0.0003, 0], [0.0003, 0.0003], [0.0002, 0.0003], [0.0002, 0.0001], [0.0001, 0.0001], [0.0001, 0.0003], [0, 0.0003], [0, 0]]] } };
  assert.equal(pointInRings(polygonCentroid(u), u.geometry.coordinates), false);
  assert.equal(pointInRings(labelAnchor(u), u.geometry.coordinates), true);
  // The same holds for the real buildings whose centroid is outside (104, 126, 230).
  for (const id of [104, 126, 230]) {
    const feature = buildings.features.find((item) => item.properties.id === id);
    assert.ok(pointInRings(labelAnchor(feature), feature.geometry.coordinates[0]), `building ${id}`);
  }
});

test("labels carry the badge icon chosen for each building, geometry is not changed", () => {
  const snapshot = JSON.stringify(buildings.features.map((feature) => feature.geometry));
  const labels = buildingLabelPoints(buildings, (p) => (p.id === 102 ? "bcsir-badge:photo" : "bcsir-badge:none"));
  assert.equal(labels.features.find((feature) => feature.properties.render_id === "102").properties.render_badge, "bcsir-badge:photo");
  assert.equal(labels.features.find((feature) => feature.properties.render_id === "101").properties.render_badge, "bcsir-badge:none");
  assert.equal(JSON.stringify(buildings.features.map((feature) => feature.geometry)), snapshot);
});

test("basemaps: the street layer is unchanged, satellite has Esri attribution, only one is visible", () => {
  const [street, satellite] = basemapLayers("street");
  assert.equal(street.id, "context-map");
  assert.equal(street.source, "osm");
  assert.deepEqual(street.paint, { "raster-opacity": 0.5, "raster-saturation": -0.62, "raster-contrast": 0.04, "raster-brightness-min": 0.2, "raster-brightness-max": 1 });
  assert.equal(BASEMAP_SOURCES.osm.tiles[0], "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assert.match(BASEMAP_SOURCES.osm.attribution, /OpenStreetMap/);
  assert.match(BASEMAP_SOURCES["esri-imagery"].attribution, /Esri/);
  assert.match(BASEMAP_SOURCES["esri-imagery"].tiles[0], /World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}/);
  assert.equal(satellite.layout.visibility, "none");
  assert.deepEqual(basemapVisibility("satellite"), { "context-map": "none", "satellite-map": "visible" });
  assert.deepEqual(basemapVisibility("street", false), { "context-map": "none", "satellite-map": "none" });
  assert.deepEqual(BASEMAPS.map((basemap) => basemap.id), ["street", "satellite"]);
  assert.equal(thumbnailUrl("street", [90.38612, 23.74024], 16), "https://tile.openstreetmap.org/16/49222/28316.png");
});

test("layer groups: labels, route and basemap keep a switch in the layer list", async () => {
  const { LAYER_GROUPS } = await import("../src/bcsir-layers.js");
  const ids = LAYER_GROUPS.map((group) => group.id);
  assert.deepEqual(ids, ["buildings", "labels", "roads", "roadsDrawing", "pathways", "boundary", "internal", "garden", "trees", "route", "models", "basemap"]);
  assert.deepEqual(LAYER_GROUPS.find((group) => group.id === "labels").layers, ["building-labels-major", "building-labels-minor"]);
});

test("route summary: walking time and distance from the network length only", () => {
  assert.equal(walkingMinutes(249), 3);
  assert.equal(walkingMinutes(20), 1);
  assert.equal(walkingMinutes(0), 0);
  assert.equal(formatDistance(249.4), "249 m");
  assert.equal(formatDistance(1234), "1.23 km");
  const service = createRouteService(readJSON("public/data/ConnectedRoads/v0/r2.json"));
  const find = (id) => buildings.features.find((feature) => feature.properties.id === id);
  const result = service.route(find(101), find(119));
  const summary = describeRoute(result);
  assert.equal(summary.status, "ok");
  assert.equal(summary.headline, "3 min walk");
  assert.match(summary.detail, /^249 m along campus roads and paths/);
});

test("route summary: a missing entrance and a missing connection are stated, not hidden", () => {
  const service = createRouteService(readJSON("public/data/ConnectedRoads/v0/r2.json"));
  const find = (id) => buildings.features.find((feature) => feature.properties.id === id);
  const noEntrance = buildings.features.find((feature) => !Number.isFinite(feature.properties.entrance_lon));
  const endpoint = service.endpointFor(noEntrance);
  assert.equal(endpoint.kind, "centroid");
  assert.match(describeEndpoint(endpoint, "destination"), /No entrance is recorded for .+ The route ends at the nearest point of the campus road network, \d+ m from the building centre\./);
  const disconnected = describeRoute(service.route(find(101), find(305)));
  assert.equal(disconnected.status, "error");
  assert.equal(disconnected.headline, "No walking route");
});
