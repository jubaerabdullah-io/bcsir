// Buildings drawn from GLB models (src/building-models.js): every BuildingBoundary
// feature with a building_model gets a placement derived from its footprint, and
// each generated GLB (npm run models:buildings) is light and built on that footprint.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { buildingModelPlacement, findBuildingByShortName, footprintFront, orientedFootprint, placedBoxCorners } from "../src/building-footprint.js";
import { createLocalFrame } from "../src/navigation/local-frame.js";
import { BUILDING_SPECS } from "../scripts/building-models/specs.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const buildings = JSON.parse(readFileSync(path.join(root, "public/data/BuildingBoundary.geojson"), "utf8"));
const modelled = buildings.features.filter((feature) => feature.properties.building_model);
const byId = (id) => buildings.features.find((feature) => feature.properties.id === id);
const near = (value, expected, tolerance, label) => assert.ok(Math.abs(value - expected) < tolerance, `${label}: ${value} (expected ${expected})`);

test("buildings are found by name and their footprint rectangle and front come from the data", () => {
  assert.equal(findBuildingByShortName(buildings, " igcrt ")?.properties.id, 110);
  assert.equal(findBuildingByShortName(buildings, "NO SUCH BUILDING"), null);
  const footprint = orientedFootprint(byId(110));
  near(footprint.length, 64.46, 0.05, "IGCRT length");
  near(footprint.width, 40.17, 0.05, "IGCRT width");
  const front = footprintFront(footprint, byId(110).properties.entrance_coords);
  near(front.bearing, 255.69, 0.05, "IGCRT front bearing");
  near(front.rotation, 75.69, 0.05, "IGCRT rotation");
  near(front.entranceOffset, -1.65, 0.05, "IGCRT entrance offset");
  // A box of the front's size, placed with that rotation, lands on the rectangle's corners.
  const placed = placedBoxCorners({ anchor: footprint.center, rotation: front.rotation, minX: -front.frontWidth / 2, maxX: front.frontWidth / 2, minZ: -front.depth / 2, maxZ: front.depth / 2 });
  const frame = createLocalFrame(footprint.center);
  for (const corner of footprint.corners) {
    const c = frame.toLocal(corner);
    assert.ok(Math.min(...placed.map((p) => Math.hypot(frame.toLocal(p)[0] - c[0], frame.toLocal(p)[1] - c[1]))) < 0.01, `corner ${corner}`);
  }
});

test("building_model placement: fit to the footprint and top_m, model_rotation and model_size", () => {
  const base = byId(127);
  const placement = buildingModelPlacement(base);
  assert.equal(placement.model, "models/buildings/secretariat.glb");
  near(placement.fit[0], 33.43, 0.05, "front width");
  near(placement.fit[2], 23.32, 0.05, "depth");
  assert.equal(placement.fit[1], 20.5, "height is top_m - base_m");
  near(placement.frontBearing, 167.6, 0.1, "front faces the entrance");
  const turned = (properties) => buildingModelPlacement({ ...base, properties: { ...base.properties, ...properties } });
  const quarter = turned({ model_rotation: 90 });
  near(quarter.rotation, (placement.rotation + 90) % 360, 1e-6, "rotation");
  near(quarter.fit[0], placement.fit[2], 1e-6, "a quarter turn fits the model to the next side");
  near(quarter.frontBearing, (placement.frontBearing + 90) % 360, 1e-6, "front bearing turns");
  const fine = turned({ model_rotation: 5 });
  assert.deepEqual(fine.fit, placement.fit, "a small turn keeps the fit");
  assert.equal(turned({ model_size: 1.2 }).size, 1.2);
  assert.equal(turned({ model_size: 0 }).size, 1, "invalid size means 1");
  assert.equal(turned({ top_m: 30 }).fit[1], 30, "a higher top_m makes the model taller");
  assert.equal(turned({ building_model: "photo.png" }), null, "only .glb/.gltf files");
});

test("wall_gap_m opens the drawn boundary wall at the gate only", async () => {
  const { cutLineGaps } = await import("../src/geo-utils.js");
  const campus = JSON.parse(readFileSync(path.join(root, "public/data/BCSIRBoundary.geojson"), "utf8"));
  assert.equal(cutLineGaps(campus, []), campus, "no gap: the walls are the same object");
  const gate = byId(301);
  const placement = buildingModelPlacement(gate);
  const gap = { point: placement.anchor, halfWidth: gate.properties.wall_gap_m / 2 };
  const frame = createLocalFrame(placement.anchor);
  const length = (paths) => paths.reduce((sum, p) => sum + p.slice(1).reduce((s, q, i) => s + Math.hypot(frame.toLocal(q)[0] - frame.toLocal(p[i])[0], frame.toLocal(q)[1] - frame.toLocal(p[i])[1]), 0), 0);
  const before = length(campus.features[0].geometry.coordinates.flat());
  const cut = cutLineGaps(campus, [gap]).features[0].geometry;
  assert.equal(cut.type, "MultiLineString");
  near(before - length(cut.coordinates), gate.properties.wall_gap_m, 0.1, "removed wall length");
  const far = cutLineGaps(campus, [{ point: [90.3, 23.7], halfWidth: 10 }]);
  assert.equal(far.features[0], campus.features[0], "a gap far from the wall changes nothing");
});

test("every building_model is a light GLB built on its footprint", async () => {
  assert.ok(modelled.length >= 8, "IGCRT, IFST, Secretariat, PPDC (2 parts), Water Tank, Main Gate and BRiCM use models");
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  let total = 0;
  for (const feature of modelled) {
    const name = feature.properties.name_en_short || feature.properties.id;
    const placement = buildingModelPlacement(feature);
    assert.ok(placement, `${name}: valid building_model and footprint`);
    const file = path.join(root, "public", placement.model);
    assert.ok(existsSync(file), `${name}: ${placement.model} exists`);
    const bytes = statSync(file).size;
    total += bytes;
    assert.ok(bytes < 300 * 1024, `${name}: under 300 KB`);
    const doc = await io.read(file);
    const primitives = doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());
    assert.equal(primitives.length, 1, `${name}: one draw call`);
    assert.equal(doc.getRoot().listMaterials().length, 1, `${name}: one material (alpha-masked where parts are see-through)`);
    const triangles = primitives.reduce((sum, prim) => sum + prim.getIndices().getCount() / 3, 0);
    assert.ok(triangles < 5000, `${name}: ${triangles} triangles`);
    for (const texture of doc.getRoot().listTextures()) assert.ok(Math.max(...texture.getSize()) <= 1024, `${name}: textures at most 1024 px`);
    // Generated models record their footprint box; it must match the building (stretch 1).
    const footprint = doc.getRoot().listScenes()[0].getExtras()?.bcsir_footprint;
    const spec = BUILDING_SPECS.find((item) => item.file === placement.model);
    if (!spec) continue;
    assert.ok(footprint, `${name}: footprint box in the scene extras`);
    near(footprint.max[0] - footprint.min[0], placement.fit[0], 0.05, `${name} width`);
    near(footprint.max[2] - footprint.min[2], placement.fit[2], 0.05, `${name} depth`);
    near(footprint.max[1] - footprint.min[1], placement.fit[1], 0.05, `${name} height`);
  }
  assert.ok(total < 1024 * 1024, `all building models under 1 MB (${Math.round(total / 1024)} KB)`);
});
