#!/usr/bin/env node
// Usage: npm run mock:tracks [-- --speed 1.3 --step 5 --noise 0 --clamp 5 --seed 42 --out <dir>]
//
// Writes mock GPS tracks for a few building pairs, so live navigation can be
// tested without walking the campus. Each route is computed exactly as the
// web app draws it: route service (original dijkstra) -> access legs
// corrected around buildings -> walked line entrance to entrance. A fix every
// --step metres and at every turn, exactly on the route. Per pair:
//   <from>-to-<to>.json        route + fixes (GeolocationPosition-shaped)
//   <from>-to-<to>.gpx         the track (Chrome DevTools sensors, emulators, Xcode)
//   <from>-to-<to>-noisy.gpx   only with --noise > 0: noisy track (also noisyFixes in the JSON)
// plus index.json listing every track. Output is deterministic for a given seed.
import "./lib/node-routing-hooks.mjs";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { normalizeBuildings } from "../src/data/bcsir-data.js";
import { blocksWalking } from "../src/navigation/collision.js";
import { correctRouteResult, prepareObstacles } from "../src/navigation/route-detour.js";
import { buildTrack, toGpx, TRACK_DEFAULTS } from "./lib/mock-track.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const NETWORK = "public/data/bcsir/ConnectedRoads/v0/r2.json";
const BUILDINGS = "public/data/bcsir/BuildingBoundary.geojson";

// [from building id, to building id]; all have entrance coordinates.
const ROUTE_PAIRS = [
  [301, 127], // Main Gate -> Secretariat
  [301, 102], // Main Gate -> INARS
  [302, 110], // Secondary Gate -> IGCRT
  [304, 124], // Chairman Gate -> Qudrat-I-Khuda Bhaban
  [203, 111], // Central Mosque -> IFST
  [101, 229] // Genomic -> High School
];

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const readJSON = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

const { values } = parseArgs({
  options: {
    speed: { type: "string", default: String(TRACK_DEFAULTS.speedMps) },
    step: { type: "string", default: String(TRACK_DEFAULTS.stepM) },
    noise: { type: "string", default: String(TRACK_DEFAULTS.noiseSigmaM) },
    clamp: { type: "string", default: String(TRACK_DEFAULTS.noiseClampM) },
    seed: { type: "string", default: String(TRACK_DEFAULTS.seed) },
    out: { type: "string", default: "public/data/bcsir/mock-tracks" }
  }
});
const options = {
  speedMps: Number(values.speed),
  stepM: Number(values.step),
  noiseSigmaM: Number(values.noise),
  noiseClampM: Number(values.clamp),
  seed: Number(values.seed)
};
for (const [key, value] of Object.entries(options)) {
  if (!Number.isFinite(value) || value < 0 || (key !== "seed" && key !== "noiseSigmaM" && value === 0)) throw new Error(`Invalid --${key}: ${value}`);
}

const { createRouteService, routePathCoordinates } = await import("../src/routing/route-service.js");
const service = createRouteService(readJSON(NETWORK));
const buildings = normalizeBuildings(readJSON(BUILDINGS));
const obstacles = prepareObstacles(buildings, { blocks: blocksWalking });
const byId = (id) => buildings.features.find((feature) => String(feature.properties.id) === String(id));
const describe = (feature, endpoint) => ({
  id: feature.properties.id,
  name: feature.properties.render_label,
  point: endpoint.point.map((v) => round(v, 7)),
  kind: endpoint.kind
});

const outDir = path.resolve(root, values.out);
mkdirSync(outDir, { recursive: true });
const index = [];

for (const [fromId, toId] of ROUTE_PAIRS) {
  const from = byId(fromId), to = byId(toId);
  if (!from || !to) { console.warn(`SKIP  ${fromId} -> ${toId}: building not found`); continue; }
  const result = correctRouteResult(service.route(from, to), obstacles);
  const coordinates = routePathCoordinates(result);
  const track = coordinates && buildTrack(coordinates, options);
  if (!track) { console.warn(`SKIP  ${fromId} -> ${toId}: no route (different network components?)`); continue; }

  const id = `${fromId}-to-${toId}`;
  const name = `${from.properties.render_label} → ${to.properties.render_label}`;
  const noisy = Boolean(track.noisyFixes);
  const files = { json: `${id}.json`, gpx: `${id}.gpx`, ...(noisy ? { noisyGpx: `${id}-noisy.gpx` } : {}) };
  const record = {
    id,
    name,
    from: describe(from, result.source),
    to: describe(to, result.destination),
    distanceM: round(track.distanceM, 1),
    durationS: round(track.durationS, 1),
    speedMps: options.speedMps,
    stepM: options.stepM,
    ...(noisy ? { noise: { sigmaM: options.noiseSigmaM, clampM: options.noiseClampM, tauS: TRACK_DEFAULTS.noiseTauS, seed: options.seed } } : {}),
    route: track.model.coordinates.map((point) => point.map((v) => round(v, 7))),
    fixes: track.fixes,
    ...(noisy ? { noisyFixes: track.noisyFixes } : {})
  };
  writeFileSync(path.join(outDir, files.json), `${JSON.stringify(record)}\n`);
  writeFileSync(path.join(outDir, files.gpx), toGpx(name, track.fixes));
  if (noisy) writeFileSync(path.join(outDir, files.noisyGpx), toGpx(`${name} (noisy)`, track.noisyFixes));
  else rmSync(path.join(outDir, `${id}-noisy.gpx`), { force: true }); // left by an earlier run with noise
  index.push({ id, name, from: record.from, to: record.to, distanceM: record.distanceM, durationS: record.durationS, fixes: track.fixes.length, files });
  console.log(`OK    ${id.padEnd(12)} ${name}: ${record.distanceM} m, ${record.durationS} s, ${track.fixes.length} fixes`);
}

writeFileSync(path.join(outDir, "index.json"), `${JSON.stringify({ speedMps: options.speedMps, stepM: options.stepM, tracks: index }, null, 2)}\n`);
console.log(`\n${index.length}/${ROUTE_PAIRS.length} tracks written to ${path.relative(root, outDir) || "."}`);
