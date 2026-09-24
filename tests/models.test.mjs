// public/models/ matches public/models/lod/manifest.json (written by
// `npm run models:optimize`): every level and ground tile exists, the optimized
// models are the files the manifest describes, and the Garden surfaces resolve.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const modelsDir = path.join(root, "public/models");
const manifest = JSON.parse(readFileSync(path.join(modelsDir, "lod/manifest.json"), "utf8"));
const glbs = readdirSync(modelsDir).filter((file) => /\.glb$/i.test(file));

test("every GLB in public/models is optimized and listed in the manifest (run npm run models:optimize)", () => {
  for (const name of glbs) {
    const entry = manifest.models[name];
    assert.ok(entry, `${name} has a manifest entry`);
    const file = readFileSync(path.join(modelsDir, name));
    assert.equal(createHash("sha256").update(file).digest("hex"), entry.sha256, `${name} is the optimized file the manifest describes`);
  }
});

test("detail levels exist, get lighter and cover every on-screen size", () => {
  for (const [name, entry] of Object.entries(manifest.models)) {
    assert.equal(entry.lods[0].url, name, `${name}: level 0 is the model file itself`);
    assert.equal(entry.lods.at(-1).minPx, 0, `${name}: the coarsest level is used down to 0 px`);
    entry.lods.forEach((lod, i) => {
      assert.equal(statSync(path.join(modelsDir, lod.url)).size, lod.bytes, `${lod.url} size`);
      if (i > 0) {
        assert.ok(lod.minPx < entry.lods[i - 1].minPx, `${lod.url}: used below the previous level`);
        assert.ok(lod.triangles < entry.lods[i - 1].triangles, `${lod.url}: lighter than the previous level`);
      }
    });
    assert.ok(entry.box.min.every((v, k) => v < entry.box.max[k]), `${name}: bounding box of the original model`);
    assert.ok(entry.source.triangles >= entry.lods[0].triangles, `${name}: level 0 keeps the original geometry`);
  }
});

test("Garden surface_model polygons have a ground tile", () => {
  const garden = JSON.parse(readFileSync(path.join(root, "public/data/Garden.geojson"), "utf8"));
  const surfaced = garden.features.filter((feature) => feature.properties.surface_model);
  assert.ok(surfaced.length > 0);
  for (const feature of surfaced) {
    const { surface_model: model, surface_scale: scale, id } = feature.properties;
    const entry = manifest.models[path.basename(model)];
    assert.ok(entry?.surface, `Garden ${id}: ${model} has a ground tile`);
    assert.equal(statSync(path.join(modelsDir, entry.surface.url)).size, entry.surface.bytes);
    assert.ok(scale === undefined || scale > 0, `Garden ${id}: surface_scale is positive`);
    assert.ok(["Polygon", "MultiPolygon"].includes(feature.geometry.type));
  }
});
