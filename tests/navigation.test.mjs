// Live navigation, walk collision, drawn-route correction and public asset paths.
import "../scripts/lib/node-routing-hooks.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeBuildings, prepareDataset } from "../src/data/bcsir-data.js";
import { lineStrips } from "../src/utils/geo-utils.js";
import { createLocalFrame, distance } from "../src/utils/local-frame.js";
import { compassWord, createRouteModel, formatGuidanceDistance, guidance, locate, maneuverText } from "../src/navigation/route-progress.js";
import { blocksWalking, collisionBlockers, createCollisionWorld } from "../src/navigation/collision.js";
import { correctRouteResult, detourPath, insideLength, prepareObstacles } from "../src/navigation/route-detour.js";
import { encodeAssetPath, findListedFile } from "../src/core/asset-paths.js";
import { buildOrgIndex } from "../scripts/lib/catalog.mjs";
import { readLevelFiles } from "../scripts/lib/indoor-files.mjs";
import { createIndoorStore } from "../src/indoor/indoor-store.js";
import { levelWalkSpace, shaftLevels, shaftNear, unitAt, walkEntrances } from "../src/indoor/walk-space.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const readJSON = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const buildings = normalizeBuildings(readJSON("public/data/bcsir/BuildingBoundary.geojson"));
const network = readJSON("public/data/bcsir/ConnectedRoads/v0/r2.json");
const { createRouteService } = await import("../src/routing/route-service.js");
const service = createRouteService(network);
const building = (id) => buildings.features.find((feature) => feature.properties.id === id);

// A local square footprint `size` metres wide, south-west corner at (x, y) metres from `origin`.
const frame = createLocalFrame([90.386, 23.74]);
const square = (x, y, size) => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]].map(frame.toLngLat)];
const at = (x, y) => frame.toLngLat([x, y]);
const local = (lngLat) => frame.toLocal(lngLat);

test("route guidance: an L-shaped route has one right turn, distances and arrival", () => {
  const model = createRouteModel([at(0, 0), at(0, 50), at(40, 50)], { frame });
  assert.ok(Math.abs(model.total - 90) < 1e-6);
  assert.deepEqual(model.maneuvers.map((m) => m.type), ["depart", "right", "arrive"]);
  assert.equal(maneuverText(model.maneuvers[0]), "Head north");
  const start = guidance(model, 0);
  assert.equal(start.next.type, "right");
  assert.ok(Math.abs(start.distanceToNext - 50) < 1e-6);
  assert.equal(maneuverText(start.next), "Turn right");
  const later = guidance(model, 60);
  assert.equal(later.next.type, "arrive");
  assert.equal(maneuverText(later.next, "Main Gate"), "Arrive at Main Gate");
  assert.ok(Math.abs(later.remaining - 30) < 1e-6);
});

test("route guidance: a digitised curve gives one turn, not one per vertex", () => {
  const curve = [at(0, 0), at(0, 40)];
  for (let k = 1; k <= 9; k += 1) { const a = (k / 9) * Math.PI / 2; curve.push(at(12 - 12 * Math.cos(a), 40 + 12 * Math.sin(a))); }
  curve.push(at(60, 52));
  const model = createRouteModel(curve, { frame });
  const turns = model.maneuvers.filter((m) => !["depart", "arrive"].includes(m.type));
  assert.equal(turns.length, 1);
  assert.match(turns[0].type, /right/);
});

test("route guidance: locate snaps to the route and reports the offset", () => {
  const model = createRouteModel([at(0, 0), at(0, 50), at(40, 50)], { frame });
  const hit = locate(model, at(6, 20));
  assert.ok(Math.abs(hit.along - 20) < 1e-6);
  assert.ok(Math.abs(hit.offsetM - 6) < 1e-6);
  assert.equal(compassWord(hit.bearing), "north");
  // Near the corner the hint keeps the position on the current leg.
  const corner = locate(model, at(1, 49), { hint: 45 });
  assert.ok(corner.along > 45 && corner.along < 52);
  assert.equal(formatGuidanceDistance(7.4), "7 m");
  assert.equal(formatGuidanceDistance(47), "45 m");
  assert.equal(formatGuidanceDistance(143), "140 m");
});

test("collision: a building cannot be walked through; the walker slides along it", () => {
  const world = createCollisionWorld({ blockers: [{ id: "b", name: "Block", polygons: [square(10, -10, 20)] }], frame, radiusM: 0.35 });
  // Straight at the wall: stops 0.35 m before it.
  const straight = world.resolveMove(at(0, 0), at(20, 0));
  assert.equal(straight.blocked, true);
  assert.equal(straight.blocker.name, "Block");
  assert.ok(Math.abs(local(straight.position)[0] - 9.65) < 0.02, `stopped at ${local(straight.position)[0]}`);
  // At an angle: slides north along the wall instead of stopping.
  const slide = world.resolveMove(at(9.6, 0), at(12, 5));
  const [x, y] = local(slide.position);
  assert.ok(x <= 9.66 && y > 4.9, `slid to ${x}, ${y}`);
  // Moving away and along free space is not blocked.
  assert.equal(world.resolveMove(at(0, 0), at(-5, 3)).blocked, false);
  // A start inside the building is moved to the nearest free place outside it.
  const free = local(world.nearestFree(at(12, 0)));
  assert.ok(free[0] <= 9.66 && Math.abs(free[1]) < 0.5, `moved to ${free}`);
  assert.equal(world.blockerAt(at(15, 0)).id, "b");
  assert.equal(world.blockerAt(at(5, 0)), null);
});

test("collision: indoor areas are entered only through an entrance and stay on the selected level", () => {
  const indoor = [{ buildingId: "b", level: 0, walkable: [square(10.2, -9.8, 19.6)], entrances: [at(10, 0)] }];
  const world = createCollisionWorld({ blockers: [{ id: "b", name: "Block", polygons: [square(10, -10, 20)] }], indoor, frame });
  const state = {};
  // Away from the door: solid.
  assert.equal(world.resolveMove(at(0, 6), at(14, 6), state).blocked, true);
  assert.equal(state.indoor ?? null, null);
  // Through the door: inside, on level 0.
  const enter = world.resolveMove(at(8, 0), at(14, 0), state);
  assert.equal(enter.blocked, false);
  assert.deepEqual(state.indoor, { buildingId: "b", level: 0 });
  // Inside, the outline is a wall except at the door.
  const wall = world.resolveMove(at(14, 0), at(14, 14), state);
  assert.ok(local(wall.position)[1] < 10, "stays inside");
  const leave = world.resolveMove(at(14, 0), at(6, 0), state);
  assert.equal(state.indoor, null);
  assert.ok(local(leave.position)[0] < 10);
  // Another level has no walkable area here: the building is solid.
  world.setLevel(1);
  const other = {};
  assert.equal(world.resolveMove(at(8, 0), at(14, 0), other).blocked, true);
  assert.equal(other.indoor ?? null, null);
});

test("collision: inside a building the walker keeps to his floor, its walls and its doors", () => {
  const rect = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(frame.toLngLat)];
  // Ground floor: a wall across the middle with a gap one metre wide; the entrance is on it.
  const ground = { buildingId: "b", level: "G", walkable: [square(10, -10, 20)], walls: [rect(19.9, -10, 20.1, -0.5), rect(19.9, 0.5, 20.1, 10)], entrances: [at(10, 0)] };
  const world = createCollisionWorld({ blockers: [{ id: "b", name: "Block", polygons: [square(10, -10, 20)] }], indoor: [ground], frame });
  // First floor (added later, as when its files are loaded): the same wall without a gap, and a door point in it.
  assert.equal(world.hasFloor("b", "L1"), false);
  assert.equal(world.nearestIndoor(at(15, 0), "b", "L1"), null, "a floor that is not loaded");
  world.setIndoor({ buildingId: "b", level: "L1", walkable: [square(10, -10, 20)], walls: [rect(19.9, -10, 20.1, 10)], doors: [at(20, 5)] });
  assert.equal(world.hasFloor("b", "L1"), true);

  // From outside, away from the entrance: solid, and the blocker says it has floor plans.
  const bump = world.resolveMove(at(0, 6), at(14, 6), {});
  assert.equal(bump.blocked, true);
  assert.equal(bump.blocker.indoor, true);
  // With entering switched off (live navigation) the entrance is a wall too.
  const kept = {};
  assert.equal(world.resolveMove(at(8, 0), at(14, 0), kept, { enter: false }).blocked, true);
  assert.equal(kept.indoor ?? null, null);

  const state = {};
  world.resolveMove(at(8, 0), at(14, 0), state);
  assert.deepEqual(state.indoor, { buildingId: "b", level: "G" }, "in by the entrance, on its floor");
  // Through the gap in the wall; stopped by the wall beside it, sliding along it.
  assert.ok(local(world.resolveMove(at(14, 0), at(26, 0), state).position)[0] > 25.9, "through the gap");
  const stopped = local(world.resolveMove(at(14, 6), at(26, 6), state).position);
  assert.ok(Math.abs(stopped[0] - (19.9 - world.indoorRadiusM)) < 0.02, `stopped at ${stopped[0]}`);
  const slid = local(world.resolveMove(at(19, 6), at(21, 3), state).position);
  assert.ok(slid[0] < 19.9 && slid[1] < 3.2, `slid to ${slid}`);
  // The follow camera: the wall of his floor is in the way, which it is not from outside.
  assert.ok(Math.abs(world.firstHit(at(14, 6), at(26, 6), state).t - 5.9 / 12) < 1e-6);
  assert.equal(world.firstHit(at(14, 6), at(26, 6)), null);
  // A place to stand nearest a point in the wall is clear of it.
  const spot = local(world.nearestIndoor(at(20, 3), "b", "G"));
  assert.ok(Math.abs(spot[0] - 20) >= 0.1 + world.indoorRadiusM - 1e-6 && distance(spot, [20, 3]) < 0.6, `stands at ${spot}`);

  // Up to the first floor: its wall has no gap, its door point lets him through.
  state.indoor = { buildingId: "b", level: "L1" };
  assert.ok(local(world.resolveMove(at(14, 0), at(26, 0), state).position)[0] < 19.9, "no gap on this floor");
  assert.ok(local(world.resolveMove(at(14, 5), at(26, 5), state).position)[0] > 25.9, "through the door");
  // The entrance is on the ground floor: there is no way out up here.
  const upstairs = world.resolveMove(at(14, 0), at(6, 0), state);
  assert.ok(local(upstairs.position)[0] >= 10 && state.indoor?.level === "L1", "stays inside");
  // Back down and out.
  state.indoor = { buildingId: "b", level: "G" };
  assert.ok(local(world.resolveMove(at(14, 0), at(6, 0), state).position)[0] < 10);
  assert.equal(state.indoor, null);
});

const walls = [
  { collection: lineStrips(prepareDataset("internal", readJSON("public/data/bcsir/InternalBoundary.geojson"))), kind: "wall", name: "Internal wall" },
  { collection: lineStrips(prepareDataset("boundary", readJSON("public/data/bcsir/BCSIRBoundary.geojson"))), kind: "wall", name: "Boundary wall" }
];

test("collision on the campus data: walking a route is never blocked, walking into a building is", () => {
  const blockers = collisionBlockers({ buildings, walls });
  assert.ok(blockers.some((blocker) => blocker.kind === "wall"));
  assert.ok(!blockers.some((blocker) => blocker.id === "244"), "the flat play ground stays walkable");
  const world = createCollisionWorld({ blockers });
  const prepared = prepareObstacles(buildings, { frame: world.frame, blocks: blocksWalking });
  for (const [a, b] of [[101, 119], [102, 111], [126, 301], [110, 302]]) {
    const result = correctRouteResult(service.route(building(a), building(b)), prepared);
    assert.equal(result.ok, true, `${a} -> ${b}`);
    // Walk the network part in 0.2 m steps, as the keyboard does.
    let position = world.nearestFree(result.coordinates[0]);
    const state = {};
    for (let i = 1; i < result.coordinates.length; i += 1) {
      const target = result.coordinates[i];
      const steps = Math.ceil(distance(world.frame.toLocal(position), world.frame.toLocal(target)) / 0.2);
      for (let k = 0; k < steps; k += 1) {
        const [p, q] = [world.frame.toLocal(position), world.frame.toLocal(target)];
        const t = 1 / (steps - k);
        position = world.resolveMove(position, world.frame.toLngLat([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]), state).position;
      }
    }
    const end = world.frame.toLocal(result.coordinates.at(-1));
    assert.ok(distance(world.frame.toLocal(position), end) < 1.5, `${a} -> ${b} reached the end of the network path`);
  }
  // Genomic Research Laboratories (101): its outline and inside are not walkable,
  // and a start inside it is moved outside.
  const genomic = building(101);
  assert.equal(world.blockerAt(genomic.geometry.coordinates[0][0][0])?.id, "101", "a footprint corner");
  const noEntrance = service.endpointFor(building(117)); // no entrance recorded: its centre
  assert.equal(noEntrance.kind, "centroid");
  assert.equal(world.blockerAt(noEntrance.point)?.id, "117");
  assert.equal(world.blockerAt(world.nearestFree(noEntrance.point)), null);
  const entrance = service.endpointFor(genomic);
  const blocked = world.resolveMove(entrance.point, world.frame.toLngLat(world.frame.toLocal(entrance.point).map((v, i) => v + (world.frame.toLocal(genomic.geometry.coordinates[0][0][0])[i] - v) * 0.5)));
  assert.ok(!world.blockerAt(blocked.position), "never ends inside a building");
});

test("drawn routes: every network edge and access leg goes around buildings; node paths are unchanged", () => {
  const prepared = prepareObstacles(buildings, { blocks: blocksWalking });
  const crossing = (coordinates, own) => {
    const points = coordinates.map(prepared.frame.toLocal);
    return prepared.obstacles.filter((o) => o.id !== own && points.some((p, i) => i > 0 && insideLength(points[i - 1], p, o) > 0.25)).map((o) => o.id);
  };
  // Network edges: only the edge past Dhaka Laboratories (126) needed a detour.
  const seen = new Set();
  const detoured = new Set();
  for (const [from, neighbours] of service.graph) for (const to of neighbours.keys()) {
    const key = [from, to].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const edge = [from, to].map((k) => k.split(",").map(Number));
    const outcome = detourPath(edge, prepared);
    outcome.detours.forEach((d) => detoured.add(d.id));
    assert.deepEqual(crossing(outcome.coordinates, null), [], `edge ${key}`);
  }
  assert.deepEqual([...detoured], ["126"]);
  // Access legs: all corrected except the Water Tank (109), which stands inside
  // the footprint of the Pilot Plant (104) and is reported as unresolved.
  for (const feature of buildings.features) {
    const result = correctRouteResult(service.route(feature, building(101)), prepared);
    const own = String(feature.properties.render_id);
    const remaining = crossing(result.source.accessPath, own);
    if (feature.properties.id === 109) assert.deepEqual(result.unresolved.map((u) => u.id), ["104"]);
    else assert.deepEqual(remaining, [], `access leg of ${own}`);
  }
  // Path and endpoints stay exactly as the original algorithm returned them.
  const original = service.route(building(126), building(102));
  const corrected = correctRouteResult(original, prepared);
  assert.deepEqual(corrected.path, original.path);
  assert.equal(corrected.source.nodeKey, original.source.nodeKey);
  // A route that crosses nothing keeps its exact coordinates and length.
  const plain = service.route(building(101), building(119));
  const same = correctRouteResult(plain, prepared);
  assert.equal(same.coordinates, plain.coordinates);
  assert.equal(same.networkDistanceM, plain.networkDistanceM);
});

test("re-routing from a position uses the original algorithm towards the same destination", () => {
  const destination = building(119);
  const start = service.endpointFor(building(101));
  const fromPoint = service.routeFromPoint(start.point, destination);
  const fromBuilding = service.route(building(101), destination);
  assert.equal(fromPoint.ok, true);
  assert.deepEqual(fromPoint.path, fromBuilding.path);
  assert.equal(fromPoint.source.kind, "position");
});

test("public asset paths are URL-encoded once and matched to the real file names", () => {
  assert.equal(encodeAssetPath("image/My Photo.png"), "image/My%20Photo.png");
  assert.equal(encodeAssetPath("image/My%20Photo.png"), "image/My%20Photo.png");
  assert.equal(encodeAssetPath("image/Block #2.png"), "image/Block%20%232.png");
  assert.equal(encodeAssetPath("image/ভবন.jpg"), `image/${encodeURIComponent("ভবন")}.jpg`);
  assert.equal(encodeAssetPath("models/lod/grass.surface.webp?v=2"), "models/lod/grass.surface.webp?v=2");
  const listing = ["101.jpg", "Pilot Plant/Front View.PNG"];
  assert.equal(findListedFile("101.jpg", listing), "101.jpg");
  assert.equal(findListedFile("101.JPG", listing), "101.jpg");
  assert.equal(findListedFile("pilot plant/front view.png", listing), "Pilot Plant/Front View.PNG");
  assert.equal(findListedFile("Pilot%20Plant/Front%20View.PNG", listing), "Pilot Plant/Front View.PNG");
  assert.equal(findListedFile("missing.png", listing), null);
});

test("every image the web app references from public/ is committed to git", () => {
  const ignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^!public\/\*\*$/m, ".gitignore re-includes public/ (its *.png rule dropped the logo and the route figure from the deployment)");
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  for (const [, file] of html.matchAll(/src="\.\/([^"]+\.(?:png|jpe?g|webp|svg))"/g)) assert.ok(readFileSync(path.join(root, "public", file)).length > 0, file);
});

// The floor plans of an organisation, read from disk as the browser fetches them.
const indoorStore = (orgId) => createIndoorStore({
  org: buildOrgIndex(root, orgId),
  loadFiles: (item, level) => readLevelFiles(root, orgId, item, level),
  footprintOf: (item) => building(Number(item.buildingId))?.geometry || null
});

// Every place the walker can get to on a floor from `start`, walking as the keys do
// (0.3 m at a time, sliding along walls): { places: [[x, y]…], exits: [[x, y]…] } in
// metres of the collision frame. A move that takes him out of the building is an exit.
function explore(world, id, level, start) {
  const cell = 0.3;
  const key = (p) => `${Math.round(p[0] / cell)},${Math.round(p[1] / cell)}`;
  const first = world.frame.toLocal(start);
  const seen = new Set([key(first)]);
  const places = [first], exits = [];
  for (let i = 0; i < places.length; i += 1) {
    const p = places[i];
    for (let k = 0; k < 8; k += 1) {
      const state = { indoor: { buildingId: id, level } };
      const q = world.frame.toLocal(world.resolveMove(world.frame.toLngLat(p), world.frame.toLngLat([p[0] + Math.cos(k * Math.PI / 4) * cell, p[1] + Math.sin(k * Math.PI / 4) * cell]), state).position);
      if (!state.indoor) { exits.push(q); continue; }
      if (seen.has(key(q))) continue;
      seen.add(key(q));
      places.push(q);
    }
  }
  return { places, exits };
}

test("walking into the Secretariat: in by the main entrance, every room of every floor, out by the entrance only", async () => {
  const store = indoorStore("bcsir");
  const secretariat = store.forBuildingId(127);
  const feature = building(127);
  const id = String(feature.properties.render_id ?? feature.properties.id);
  const entrances = walkEntrances(secretariat, feature);
  assert.deepEqual(entrances.map((entrance) => [entrance.level, entrance.name]), [["L01", "Main Entrance"]]);
  // Without entrance points, the recorded entrance of the building is used, on its outline.
  const assumed = walkEntrances({ ...secretariat, entrances: [] }, feature);
  assert.equal(assumed.length, 1);
  assert.equal(assumed[0].level, "L01");
  assert.ok(distance(local(assumed[0].point), local(entrances[0].point)) < 1.5, "beside the main entrance");

  const world = createCollisionWorld({ blockers: collisionBlockers({ buildings, walls }) });
  const metres = (a, b) => distance(world.frame.toLocal(a), world.frame.toLocal(b));
  const models = new Map();
  for (const level of secretariat.levels) {
    const model = await store.level(secretariat.key, level.id);
    models.set(level.id, model);
    const space = levelWalkSpace(model, { entrances: entrances.filter((entrance) => entrance.level === level.id).map((entrance) => entrance.point) });
    assert.ok(space.walkable.length && space.walls.length, `${level.id}: a floor outline and walls`);
    world.setIndoor({ buildingId: id, ...space });
  }
  assert.equal(world.hasIndoor(id), true);

  // From the recorded entrance of the building (where a route to it ends), straight in.
  const door = entrances[0].point;
  const outside = world.nearestFree(feature.properties.entrance_coords);
  const [o, d] = [world.frame.toLocal(outside), world.frame.toLocal(door)];
  const scale = (distance(o, d) + 3) / distance(o, d);
  const state = {};
  const entered = world.resolveMove(outside, world.frame.toLngLat([o[0] + (d[0] - o[0]) * scale, o[1] + (d[1] - o[1]) * scale]), state);
  assert.deepEqual(state.indoor, { buildingId: id, level: "L01" });
  assert.ok(metres(entered.position, door) > 2, "three metres into the entrance lobby");
  // Anywhere else its outline is a wall.
  const ring = feature.geometry.coordinates[0][0];
  const behind = {};
  world.resolveMove(world.nearestFree([(ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2]), secretariat.entry.center, behind);
  assert.equal(behind.indoor ?? null, null, "not through the back wall");

  for (const level of secretariat.levels) {
    const model = models.get(level.id);
    const lift = secretariat.shafts.find((shaft) => shaft.class === "lift").members.get(level.id).point;
    const start = level.id === "L01" ? entered.position : world.nearestIndoor(lift, id, level.id);
    assert.ok(start && (level.id === "L01" || metres(start, lift) < 1), `${level.id}: a place to stand at the lift`);
    const { places, exits } = explore(world, id, level.id, start);
    const reached = (point) => places.some((place) => distance(place, world.frame.toLocal(point)) < 0.6);
    for (const unit of model.units) assert.ok(reached(unit.point), `${level.id}: ${unit.name} is walked into`);
    for (const poi of model.pois) assert.ok(reached(poi.point), `${level.id}: ${poi.name} is walked to`);
    for (const place of places) assert.equal(world.blockerAt(world.frame.toLngLat(place))?.id, id, `${level.id}: stays in the building`);
    if (level.id === "L01") {
      assert.ok(exits.length > 0, "the entrance leads out");
      for (const exit of exits) assert.ok(distance(exit, world.frame.toLocal(door)) < 2.5, "out by the entrance only");
    } else assert.equal(exits.length, 0, `${level.id}: no way out but the lift and the stairs`);
    // The room he stands in, and the lift or stairs he stands at.
    const room = model.units[0];
    assert.equal(unitAt(model, room.point)?.uid, room.uid);
    assert.equal(unitAt(model, lift), null, "the lift lobby is not a room");
    assert.equal(shaftNear(secretariat, level.id, lift)?.class, "lift");
    assert.equal(shaftNear(secretariat, level.id, room.point), null);
  }
  assert.deepEqual(shaftLevels(secretariat, secretariat.shafts[0]).map((level) => level.id), ["L01", "L02", "L03", "L04", "L05", "L06"]);
});

