// Mock GPS tracks: sampling along the route, seeded noise and GPX output.
import "../scripts/lib/node-routing-hooks.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeBuildings } from "../src/data/bcsir-data.js";
import { blocksWalking } from "../src/navigation/collision.js";
import { correctRouteResult, prepareObstacles } from "../src/navigation/route-detour.js";
import { locate } from "../src/navigation/route-progress.js";
import { distance } from "../src/utils/local-frame.js";
import { buildTrack, toGpx } from "../scripts/lib/mock-track.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const readJSON = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const buildings = normalizeBuildings(readJSON("public/data/bcsir/BuildingBoundary.geojson"));
const { createRouteService, routePathCoordinates } = await import("../src/routing/route-service.js");
const service = createRouteService(readJSON("public/data/bcsir/ConnectedRoads/v0/r2.json"));
const byId = (id) => buildings.features.find((feature) => String(feature.properties.id) === String(id));
const result = correctRouteResult(service.route(byId(301), byId(127)), prepareObstacles(buildings, { blocks: blocksWalking }));
const coordinates = routePathCoordinates(result);
const lngLat = (fix) => [fix.coords.longitude, fix.coords.latitude];

test("fixes lie on the route every stepM metres and at every turn, at walking pace", () => {
  const track = buildTrack(coordinates, { speedMps: 1.5, stepM: 5, dwellStartS: 2, dwellEndS: 2 });
  const { model, fixes } = track;
  assert.equal(track.noisyFixes, null, "no noise by default");
  assert.ok(fixes.length < model.total / 5 + model.maneuvers.length + 4, `${fixes.length} fixes`);
  assert.ok(distance(model.frame.toLocal(lngLat(fixes[0])), model.points[0]) < 0.05);
  assert.ok(distance(model.frame.toLocal(lngLat(fixes.at(-1))), model.points.at(-1)) < 0.05);
  assert.equal(fixes[0].timestamp, 0);
  assert.equal(fixes[0].coords.speed, 0);
  let hint = null, previous = null;
  const alongs = fixes.map((fix) => {
    const hit = locate(model, lngLat(fix), { hint });
    assert.ok(hit.offsetM < 0.05, `fix at ${fix.t} s is ${hit.offsetM} m off the route`);
    hint = hit.along;
    return hit.along;
  });
  fixes.forEach((fix, i) => {
    if (i) assert.ok(alongs[i] - alongs[i - 1] <= 5 + 0.05, `gap ${alongs[i] - alongs[i - 1]} m`);
    if (fix.coords.speed > 0) assert.ok(Math.abs(fix.t - (2 + alongs[i] / 1.5)) < 0.01, `time of the fix at ${alongs[i]} m`);
    if (previous) assert.ok(fix.timestamp > previous.timestamp);
    previous = fix;
  });
  // Every turn is a fix of its own, so the track never cuts a corner.
  model.maneuvers.forEach((maneuver) => assert.ok(alongs.some((along) => Math.abs(along - maneuver.along) < 0.05), `${maneuver.type} at ${maneuver.along} m`));
  assert.ok(Math.abs(track.durationS - (model.total / 1.5 + 4)) < 1e-9);
});

test("noisy fixes stay within the clamp and are reproducible from the seed", () => {
  const options = { stepM: 2, noiseSigmaM: 3, noiseClampM: 5, seed: 7 };
  const a = buildTrack(coordinates, options);
  const b = buildTrack(coordinates, options);
  const c = buildTrack(coordinates, { ...options, seed: 8 });
  assert.deepEqual(a.noisyFixes, b.noisyFixes);
  assert.notDeepEqual(a.noisyFixes, c.noisyFixes);
  assert.equal(a.noisyFixes.length, a.fixes.length);
  let maxError = 0;
  a.noisyFixes.forEach((fix, i) => {
    const error = distance(a.model.frame.toLocal(lngLat(fix)), a.model.frame.toLocal(lngLat(a.fixes[i])));
    maxError = Math.max(maxError, error);
    assert.ok(error <= 5 + 0.01, `error ${error} m`);
    assert.ok(fix.coords.accuracy >= 4 && fix.coords.accuracy <= 8);
  });
  assert.ok(maxError > 0.5, "noise is applied");
});

test("GPX lists every fix with a time", () => {
  const { fixes } = buildTrack(coordinates);
  const gpx = toGpx("Main Gate → Secretariat & back", fixes);
  assert.match(gpx, /^<\?xml/);
  assert.match(gpx, /<name>Main Gate → Secretariat &amp; back<\/name>/);
  assert.equal(gpx.match(/<trkpt /g).length, fixes.length);
  assert.match(gpx, /<time>2026-01-01T00:00:00.000Z<\/time>/);
});
