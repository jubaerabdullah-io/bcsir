#!/usr/bin/env node
// Usage: npm run verify:routing
//
// Proves that the 3D map routes with the ORIGINAL BCSIR routing implementation
// and produces the same results:
//  1. connection_check.js and the routing network the web app loads,
//     public/data/ConnectedRoads/v0/r2.json, are byte-identical to the recorded
//     originals. (The root copy ConnectedRoads/v0/r2.json was a byte-identical
//     duplicate and was removed; the recorded sha256 is unchanged.)
//  2. The functions served to the browser are verbatim copies of the ones in
//     connection_check.js.
//  3. The graph built by the web route service equals the graph built by the
//     original buildGraph() (same nodes, edges and weights).
//  4. The UNMODIFIED connection_check.js is executed in a temporary folder with
//     r2.json and a pois.json made of the building entrances snapped to network
//     nodes (the repository does not contain pois.json). Its output (graph
//     connectivity, components, "No path found" pairs) must equal the web route
//     service's results for the same points.
//  5. For every pair of points, the web route equals the original dijkstra() path.
import "./lib/node-routing-hooks.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildRoutingModule, extractFunction, importOriginalRouting, ORIGINAL_ROUTING_FUNCTIONS, readOriginalRoutingSource } from "./lib/original-routing.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const NETWORK = "public/data/ConnectedRoads/v0/r2.json";
const BUILDINGS = "public/data/BuildingBoundary.geojson";

export async function verifyRouting({ log = console.log } = {}) {
  const results = [];
  const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };
  const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
  const manifest = Object.fromEntries(readFileSync(path.join(root, "original-files.sha256"), "utf8")
    .split(/\r?\n/).filter((line) => line && !line.startsWith("#"))
    .map((line) => { const [hash, ...file] = line.trim().split(/\s+/); return [file.join(" "), hash]; }));

  // 1. Originals unchanged
  check("connection_check.js is unchanged", sha256(readFileSync(path.join(root, "connection_check.js"))) === manifest["connection_check.js"]);
  // The web app loads the routing network from public/data; it must be the original network.
  check(`${NETWORK} (loaded by the web app) is byte-identical to the original routing network`, sha256(readFileSync(path.join(root, NETWORK))) === manifest[NETWORK]);

  // 2. Verbatim extraction
  const source = readOriginalRoutingSource(root);
  const moduleText = buildRoutingModule(root);
  check("Browser routing module contains the original functions verbatim",
    ORIGINAL_ROUTING_FUNCTIONS.every((name) => source.includes(extractFunction(source, name)) && moduleText.includes(extractFunction(source, name))),
    ORIGINAL_ROUTING_FUNCTIONS.join(", "));

  // 3. Graph equality
  const network = JSON.parse(readFileSync(path.join(root, NETWORK), "utf8"));
  const original = await importOriginalRouting(root);
  const { createRouteService } = await import(pathToFileURL(path.join(root, "src/routing/route-service.js")).href);
  const { normalizeBuildings } = await import(pathToFileURL(path.join(root, "src/bcsir-data.js")).href);
  const service = createRouteService(network);
  const reference = original.buildGraph(network);
  const sameGraph = service.graph.size === reference.size && [...reference].every(([node, edges]) => {
    const other = service.graph.get(node);
    return other && other.size === edges.size && [...edges].every(([to, weight]) => other.get(to) === weight);
  });
  check("Web route graph equals the original buildGraph() output", sameGraph,
    `${service.stats.nodes} nodes, ${service.stats.directedEdges} directed edges, components ${JSON.stringify(service.stats.components)}`);

  // Points: every building's entrance (or centroid) snapped to its nearest network node.
  const buildings = normalizeBuildings(JSON.parse(readFileSync(path.join(root, BUILDINGS), "utf8")));
  const endpoints = buildings.features.map((feature) => service.endpointFor(feature));
  const poiKeys = [...new Set(endpoints.map((endpoint) => endpoint.nodeKey))];
  const snaps = endpoints.map((endpoint) => endpoint.snapDistanceM).sort((a, b) => a - b);
  log(`      ${buildings.features.length} buildings -> ${poiKeys.length} distinct network nodes; snap distance median ${snaps[Math.floor(snaps.length / 2)].toFixed(2)} m, max ${snaps.at(-1).toFixed(2)} m`);

  // 4. Run the unmodified original script
  const work = mkdtempSync(path.join(tmpdir(), "bcsir-routing-"));
  let captured;
  try {
    copyFileSync(path.join(root, "connection_check.js"), path.join(work, "connection_check.js"));
    copyFileSync(path.join(root, NETWORK), path.join(work, "r2.json"));
    const pois = { type: "FeatureCollection", features: poiKeys.map((key) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: key.split(",").map(Number) } })) };
    writeFileSync(path.join(work, "pois.json"), JSON.stringify(pois));
    const captureFile = path.join(work, "capture.json");
    const started = Date.now();
    execFileSync(process.execPath, ["--import", pathToFileURL(path.join(root, "scripts/lib/capture-console.mjs")).href, "connection_check.js"], {
      cwd: work,
      env: { ...process.env, BCSIR_CAPTURE_FILE: captureFile },
      stdio: ["ignore", "ignore", "inherit"],
      timeout: 15 * 60 * 1000
    });
    check("Unmodified connection_check.js runs to completion",
      sha256(readFileSync(path.join(work, "connection_check.js"))) === manifest["connection_check.js"],
      `${poiKeys.length} POIs, ${poiKeys.length * (poiKeys.length - 1) / 2} pairs, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    captured = JSON.parse(readFileSync(captureFile, "utf8"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const originalNoPath = captured.filter((args) => args[2] === "No path found")
    .map(([a, b]) => `${a.lon.toFixed(6)},${a.lat.toFixed(6)}|${b.lon.toFixed(6)},${b.lat.toFixed(6)}`).sort();
  const originalConnected = captured.find((args) => args[0] === "Graph connected:")?.[1];
  const originalComponents = captured.at(-1)[0];

  // 5. Same points through the web route service
  const pointFeature = (key) => {
    const [lon, lat] = key.split(",").map(Number);
    return { type: "Feature", properties: { entrance_lon: lon, entrance_lat: lat }, geometry: { type: "Point", coordinates: [lon, lat] } };
  };
  const webNoPath = [];
  let identicalPaths = 0, pairs = 0, routed = 0;
  for (let i = 0; i < poiKeys.length - 1; i += 1) {
    for (let j = i + 1; j < poiKeys.length; j += 1) {
      pairs += 1;
      const result = service.route(pointFeature(poiKeys[i]), pointFeature(poiKeys[j]));
      const expected = original.dijkstra(reference, poiKeys[i], poiKeys[j]);
      if (result.ok) routed += 1; else webNoPath.push(`${poiKeys[i]}|${poiKeys[j]}`);
      if (JSON.stringify(result.ok ? result.path : null) === JSON.stringify(expected)) identicalPaths += 1;
    }
  }
  webNoPath.sort();
  const normalize = (components) => components.map((component) => [...component].sort().join(";")).sort();
  check("Graph connectivity equals the original script output", originalConnected === service.stats.connected, `original: ${originalConnected}, web: ${service.stats.connected}`);
  check("Connected components equal the original script output", JSON.stringify(normalize(originalComponents)) === JSON.stringify(normalize(service.components)), `component sizes ${JSON.stringify(originalComponents.map((c) => c.length))}`);
  check("'No path found' pairs equal the original script output", JSON.stringify(originalNoPath) === JSON.stringify(webNoPath), `${originalNoPath.length} unreachable pairs in both; ${routed} of ${pairs} pairs routed`);
  check("Every web route equals the original dijkstra() path", identicalPaths === pairs, `${identicalPaths}/${pairs} identical`);
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = await verifyRouting();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} routing checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
