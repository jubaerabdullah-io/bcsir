// Organisations, floor folders, the walking grid and routes across floors.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCatalog, buildOrgIndex, listOrganisations } from "../scripts/lib/catalog.mjs";
import { readLevelFiles } from "../scripts/lib/indoor-files.mjs";
import { sampleFloors } from "../scripts/lib/sample-floors.mjs";
import { orgAssetKey, orgAssetPath } from "../src/core/asset-paths.js";
import { pointInRings } from "../src/utils/geo-utils.js";
import { buildLevelModel } from "../src/indoor/indoor-model.js";
import { connectorSeconds, createBuildingRouter, groupShafts } from "../src/indoor/indoor-router.js";
import { createIndoorStore } from "../src/indoor/indoor-store.js";
import { defaultLevel, featureKeys, folderKey, levelFileKind, parseLevelFolder, poiClass, sortLevels, unitClass } from "../src/indoor/levels.js";
import { createNavGrid } from "../src/indoor/nav-grid.js";
import { describeTrip, planIndoorTrip } from "../src/indoor/trip.js";
import { initials, statLabels } from "../src/ui/org-picker.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const storeOf = (orgId) => {
  const org = buildOrgIndex(root, orgId);
  const buildings = org.datasets.buildings ? JSON.parse(readFileSync(path.join(root, "public/data", orgId, org.datasets.buildings), "utf8")).features : [];
  const store = createIndoorStore({
    org,
    loadFiles: (building, level) => readLevelFiles(root, orgId, building, level),
    footprintOf: (building) => buildings.find((feature) => String(feature.properties.id) === String(building.buildingId))?.geometry || null
  });
  return { org, store };
};

test("floor folders: L01, G, B1 and friends are ordered from the lowest floor up", () => {
  assert.deepEqual(parseLevelFolder("L01"), { id: "L01", ordinal: 1, short: "L1", name: "Level 1" });
  assert.equal(parseLevelFolder("L12").ordinal, 12);
  assert.equal(parseLevelFolder("level 3").ordinal, 3);
  assert.equal(parseLevelFolder("7").short, "L7");
  assert.deepEqual(parseLevelFolder("G"), { id: "G", ordinal: 0, short: "G", name: "Ground floor" });
  assert.equal(parseLevelFolder("L00").short, "G");
  assert.deepEqual(parseLevelFolder("B2"), { id: "B2", ordinal: -2, short: "B2", name: "Basement 2" });
  for (const notAFloor of ["directory", "v0", "ConnectedRoads", "images", ""]) assert.equal(parseLevelFolder(notAFloor), null, notAFloor);
  const levels = ["L02", "B1", "G", "L10", "L01"].map(parseLevelFolder);
  assert.deepEqual(sortLevels(levels).map((level) => level.id), ["B1", "G", "L01", "L02", "L10"]);
  assert.equal(defaultLevel(levels).id, "G", "a building opens on its lowest floor above ground");
  assert.equal(defaultLevel([{ id: "L03", ordinal: 3, is_default: true }, { id: "L01", ordinal: 1 }]).id, "L03");
});

test("floor files: the five standard names, and any other name is a room layer", () => {
  assert.equal(levelFileKind("level.geojson").kind, "level");
  assert.equal(levelFileKind("corridor.geojson").kind, "corridor");
  assert.equal(levelFileKind("Walls.geojson").kind, "walls");
  assert.equal(levelFileKind("pois.geojson").kind, "pois");
  assert.equal(levelFileKind("doors.geojson").kind, "doors");
  assert.deepEqual(levelFileKind("shops.geojson"), { kind: "units", unitClass: "shop" });
  assert.deepEqual(levelFileKind("offices.geojson"), { kind: "units", unitClass: "office" });
  assert.equal(poiClass({ type: "Elevator" }), "lift");
  assert.equal(poiClass({ Category: "Staircase" }), "stairs");
  assert.equal(poiClass({ name: "Lift B" }), "lift", "the class is read from the name when no class is set");
  assert.equal(poiClass({ name: "Notice board" }), "poi");
  assert.equal(unitClass({ class: "Meeting Room" }, "shop"), "meeting-room");
  assert.equal(unitClass({}, "shop"), "shop");
  assert.deepEqual(featureKeys([{ properties: { id: 7 } }, { properties: {} }, { properties: { id: 7 } }]), ["7", "#2", "7~2"]);
  assert.equal(folderKey("Building-01 (Secretariat Building)"), "building-01-secretariat-building");
});

test("organisation files: models and photos resolve inside the organisation's folder", () => {
  for (const value of ["tree.glb", "/models/tree.glb", "models/tree.glb", "./models/tree.glb", "models/bcsir/tree.glb"]) assert.equal(orgAssetPath("models", value, "bcsir"), "models/bcsir/tree.glb", value);
  assert.equal(orgAssetPath("models", "models/buildings/igcrt.glb", "bcsir"), "models/bcsir/buildings/igcrt.glb");
  assert.equal(orgAssetPath("models", "shared/trees/palm.glb", "bcsir"), "models/shared/trees/palm.glb");
  assert.equal(orgAssetPath("image", "/image/101.jpg", "taqwafabrics"), "image/taqwafabrics/101.jpg");
  assert.equal(orgAssetPath("image", "https://example.org/a.jpg", "bcsir"), "https://example.org/a.jpg");
  assert.equal(orgAssetKey("image", "/image/101.jpg", "bcsir"), "101.jpg");
  assert.equal(orgAssetKey("models", "shared/a.glb", "bcsir"), null);
});

test("catalog: every organisation folder is listed with its datasets, photos and floors", () => {
  const ids = listOrganisations(root);
  assert.ok(ids.includes("bcsir"));
  const catalog = buildCatalog(root);
  assert.deepEqual(catalog.organisations.map((org) => org.id).sort(), [...ids].sort());
  assert.equal(catalog.organisations.filter((org) => org.default).length, 1, "one default organisation (old ?buildingid= links)");
  for (const id of ids) {
    const index = buildOrgIndex(root, id);
    assert.deepEqual(index.problems, [], `${id}: ${index.problems.join("; ")}`);
    for (const file of Object.values(index.datasets)) assert.ok(existsSync(path.join(root, "public/data", id, file)), `${id}/${file}`);
    if (index.logo) assert.ok(existsSync(path.join(root, "public/image", index.image_folder || id, index.logo)), `${id} logo`); // image_folder: photos shared with another organisation
    const uids = index.places.map((place) => place.uid);
    assert.equal(new Set(uids).size, uids.length, `${id}: place ids are unique`);
    for (const building of index.indoor) {
      assert.ok(building.levels.length > 0);
      assert.equal(new Set(building.levels.map((level) => level.ordinal)).size, building.levels.length, `${id}/${building.folder}: one floor per number`);
      if (index.datasets.buildings) assert.ok(building.building_id, `${id}/${building.folder} is linked to a building footprint`);
      for (const level of building.levels) assert.ok(existsSync(path.join(root, "public/data", id, building.folder, level.id)), `${building.folder}/${level.id}`);
    }
  }
  const bcsir = buildOrgIndex(root, "bcsir");
  assert.equal(bcsir.stats.buildings, 86);
  assert.equal(bcsir.datasets.network, "ConnectedRoads/v0/r2.json");
  assert.ok(bcsir.images.includes("101.jpg") && bcsir.logo === "logo.png");
  assert.ok(bcsir.directory.laboratories && bcsir.directory.services);
});

test("every organisation's models and photos are in its own folder", () => {
  for (const folder of ["public/models", "public/image", "public/data"]) {
    const loose = readdirSync(path.join(root, folder), { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.name.startsWith("."));
    assert.deepEqual(loose.map((entry) => entry.name), [], `${folder}/ holds only organisation folders`);
  }
});

test("organisation picker: initials and what a card says is mapped", () => {
  assert.equal(initials("Taqwa Fabrics Ltd"), "TF");
  assert.equal(initials("BCSIR"), "BC");
  assert.deepEqual(statLabels({ buildings: 86, floors: 6, places: 47 }), ["86 buildings", "6 floors mapped", "47 rooms"]);
  assert.deepEqual(statLabels({ buildings: 1, floors: 0 }), ["1 building"]);
});

// A 20 x 10 m floor: a 2 m corridor along the middle, a room on each side.
const square = (x0, y0, x1, y1) => {
  const lon = (x) => 90 + x / (111320 * Math.cos(23 * Math.PI / 180)), lat = (y) => 23 + y / 110574;
  return [[[lon(x0), lat(y0)], [lon(x1), lat(y0)], [lon(x1), lat(y1)], [lon(x0), lat(y1)], [lon(x0), lat(y0)]]];
};
const at = (x, y) => square(x, y, x, y)[0][0];

test("walking grid: routes stay in the corridor and go round corners", () => {
  // An L-shaped corridor: 20 m east, then 10 m north.
  const grid = createNavGrid({ walkable: [square(0, 0, 20, 2), square(18, 0, 20, 12)] });
  assert.ok(grid.walkableCells > 200);
  const from = grid.nearestCell(at(1, 1)), to = grid.nearestCell(at(19, 11));
  assert.equal(from.distanceM, 0);
  const found = grid.path(from.cell, to.cell);
  assert.ok(found.distanceM > 27 && found.distanceM < 30, `L-shaped walk of about 28 m, got ${found.distanceM.toFixed(1)}`);
  for (const point of found.coordinates) assert.ok(pointInRings(point, square(0, 0, 20, 2)) || pointInRings(point, square(18, 0, 20, 12)), "every vertex is in the corridor");
  assert.ok(found.coordinates.length <= 5, `a straightened path, got ${found.coordinates.length} vertices`);
  // Two corridors that do not touch are not connected.
  const split = createNavGrid({ walkable: [square(0, 0, 5, 2), square(10, 0, 15, 2)] });
  assert.equal(split.path(split.nearestCell(at(1, 1)).cell, split.nearestCell(at(12, 1)).cell), null);
  assert.equal(grid.nearestCell(at(40, 40), 5), null, "nothing walkable within 5 m");
  // A room beside the corridor is reached from the corridor cell nearest its middle.
  const room = square(4, 2, 10, 8);
  const access = grid.nearestCellToPolygon(room, at(7, 5));
  const [x] = grid.frame.toLocal(grid.cellCentre(access.cell));
  assert.ok(Math.abs(x - grid.frame.toLocal(at(7, 5))[0]) < 0.6, "the access point is in front of the room's middle");
  // Without corridors, the floor less its rooms is walkable.
  const open = createNavGrid({ walkable: [square(0, 0, 10, 10)], blocked: [square(2, 2, 8, 8)] });
  assert.equal(open.isWalkable(open.cellOf(at(5, 5))), false);
  assert.equal(open.isWalkable(open.cellOf(at(1, 1))), true);
});

test("shafts: lifts and stairs standing at the same place on different floors are one shaft", () => {
  const connector = (id, type, level, x, y, extra = {}) => ({ uid: id, class: type, name: id, level, point: at(x, y), ...extra });
  const shafts = groupShafts([
    connector("lift-1", "lift", "L01", 5, 5), connector("lift-2", "lift", "L02", 5.4, 5.2), connector("lift-3", "lift", "L03", 5, 5),
    connector("stair-1", "stairs", "L01", 5.5, 5), connector("stair-2", "stairs", "L02", 5.5, 5),
    connector("lift-far", "lift", "L01", 40, 5),
    connector("a", "lift", "L01", 60, 0, { connector_id: "east" }), connector("b", "lift", "L05", 90, 30, { connector_id: "east" })
  ]);
  assert.deepEqual(shafts.map((shaft) => [shaft.class, [...shaft.members.keys()].join(",")]), [["lift", "L01,L02,L03"], ["stairs", "L01,L02"], ["lift", "L01"], ["lift", "L01,L05"]]);
  assert.equal(connectorSeconds("lift", 5), 35);
  assert.equal(connectorSeconds("stairs", -2), 32);
});

test("router: another floor is reached by the lift or the stairs, whichever is quicker", () => {
  // Each floor: one corridor; the lift at its west end, the stairs at its east end.
  const levels = [1, 2, 6].map((ordinal) => ({ id: `L0${ordinal}`, ordinal, grid: createNavGrid({ walkable: [square(0, 0, 40, 2)] }) }));
  const shafts = groupShafts(levels.flatMap((level) => [
    { uid: `lift-${level.id}`, class: "lift", name: "Lift A", level: level.id, point: at(1, 1) },
    { uid: `stairs-${level.id}`, class: "stairs", name: "Stair 1", level: level.id, point: at(39, 1) }
  ]));
  const router = createBuildingRouter({ key: "test", levels, shafts });
  const anchor = (level, x, label) => ({ level, point: at(x, 1), cell: levels.find((item) => item.id === level).grid.nearestCell(at(x, 1)).cell, label });

  const up = router.route(anchor("L01", 20, "Room A"), anchor("L06", 20, "Room B"));
  assert.equal(up.ok, true);
  assert.deepEqual(up.legs.map((leg) => leg.type), ["walk", "connector", "walk"]);
  assert.equal(up.legs[1].class, "lift", "five floors up: the lift");
  assert.deepEqual([up.legs[1].fromLevel, up.legs[1].toLevel, up.legs[1].floors, up.legs[1].direction], ["L01", "L06", 5, "up"], "directly to the destination floor");
  assert.equal(up.legs[0].to, "Lift A");
  assert.equal(up.legs[2].to, "Room B");
  assert.equal(up.floorChanges, 1);

  const near = router.route(anchor("L01", 38, "Room C"), anchor("L02", 38, "Room D"));
  assert.equal(near.legs[1].class, "stairs", "one floor up beside the stairs: the stairs");
  const stepFree = router.route(anchor("L01", 38, "Room C"), anchor("L02", 38, "Room D"), { stepFree: true });
  assert.equal(stepFree.legs[1].class, "lift", "step-free: the lift, although it is farther");
  assert.equal(router.route(anchor("L06", 30, "Room B"), anchor("L01", 5, "Room A")).legs[1].direction, "down");

  const same = router.route(anchor("L02", 5, "Room E"), anchor("L02", 30, "Room F"));
  assert.deepEqual(same.legs.map((leg) => leg.type), ["walk"]);
  assert.ok(Math.abs(same.distanceM - 25) < 1.5);

  // No shaft joins L01 and L06 directly: stairs L01-L02, then a lift L02-L06.
  const split = createBuildingRouter({ key: "test", levels, shafts: groupShafts([
    { uid: "s1", class: "stairs", name: "Stair 1", level: "L01", point: at(39, 1) }, { uid: "s2", class: "stairs", name: "Stair 1", level: "L02", point: at(39, 1) },
    { uid: "l2", class: "lift", name: "Lift B", level: "L02", point: at(1, 1) }, { uid: "l6", class: "lift", name: "Lift B", level: "L06", point: at(1, 1) }
  ]) });
  const transfer = split.route(anchor("L01", 20, "Room A"), anchor("L06", 20, "Room B"));
  assert.deepEqual(transfer.legs.map((leg) => (leg.type === "connector" ? `${leg.class}:${leg.fromLevel}>${leg.toLevel}` : `walk:${leg.level}`)), ["walk:L01", "stairs:L01>L02", "walk:L02", "lift:L02>L06", "walk:L06"]);
  assert.equal(createBuildingRouter({ key: "test", levels, shafts: [] }).route(anchor("L01", 20, "A"), anchor("L06", 20, "B")).reason, "no-connector");
});

test("template floors: the five files per floor, inside the footprint, routable", () => {
  const building = { type: "Feature", properties: { id: 9, entrance_coords: at(15, -1) }, geometry: { type: "Polygon", coordinates: square(0, 0, 30, 16) } };
  const { files, summary } = sampleFloors(building, { floors: 3 });
  assert.deepEqual(Object.keys(files).filter((file) => file.startsWith("L02/")).sort(), ["L02/corridor.geojson", "L02/level.geojson", "L02/pois.geojson", "L02/shops.geojson", "L02/walls.geojson"]);
  assert.equal(files["building.json"].sample, true);
  assert.equal(summary.floors, 3);
  for (const [file, data] of Object.entries(files)) {
    if (!/(shops|corridor|pois)\.geojson$/.test(file)) continue;
    for (const feature of data.features) {
      const points = feature.geometry.type === "Point" ? [feature.geometry.coordinates] : feature.geometry.coordinates[0];
      for (const point of points) assert.ok(point[0] >= 90 - 1e-9 && point[1] >= 23 - 1e-9 && pointInRings(point, square(-0.01, -0.01, 30.01, 16.01)), `${file}: inside the footprint`);
    }
  }
  assert.ok(files["L01/pois.geojson"].features.some((feature) => feature.properties.class === "entrance"), "an entrance on the first floor");
  assert.ok(!files["L02/pois.geojson"].features.some((feature) => feature.properties.class === "entrance"));
  const model = buildLevelModel({ buildingKey: "b", level: { id: "L01", ordinal: 1 }, files: { level: files["L01/level.geojson"], corridor: [files["L01/corridor.geojson"]], walls: [files["L01/walls.geojson"]], doors: [], pois: [{ file: "pois.geojson", data: files["L01/pois.geojson"] }], units: [{ file: "shops.geojson", class: "shop", data: files["L01/shops.geojson"] }] } });
  assert.deepEqual(model.problems, []);
  for (const unit of model.units) assert.ok(model.anchorFor(unit.uid), `${unit.name} is reached from the corridor`);
  for (const poi of model.pois) assert.ok(model.anchorFor(poi.uid), `${poi.name} is on the walkable area`);
  assert.ok(model.render.features.some((feature) => feature.properties.kind === "wall"));
});

test("BCSIR Secretariat: a room on the first floor to a room on the sixth goes by the lift", async () => {
  const { org, store } = storeOf("bcsir");
  const building = store.forBuildingId(127);
  assert.ok(building, "the Secretariat has floor plans");
  assert.equal(building.levels.length, 6);
  assert.deepEqual(building.shafts.map((shaft) => [shaft.class, shaft.members.size]), [["lift", 6], ["stairs", 6], ["stairs", 6]]);
  const find = (level, name) => org.places.find((place) => place.building === building.key && place.level === level && place.name === name);
  const from = find("L01", "Reception"), to = org.places.find((place) => place.building === building.key && place.level === "L06" && place.kind === "unit");
  const trip = await planIndoorTrip({ store, sameBuilding: true, source: { key: building.key, uid: from.uid, door: null }, destination: { key: building.key, uid: to.uid, door: null } });
  assert.deepEqual(trip.problems, []);
  assert.equal(trip.start.ok, true);
  assert.deepEqual(trip.start.legs.map((leg) => (leg.type === "connector" ? `${leg.class}:${leg.fromLevel}>${leg.toLevel}` : `walk:${leg.level}`)), ["walk:L01", "lift:L01>L06", "walk:L06"]);
  // Walk legs follow the corridors: every vertex between the two end points is walkable.
  for (const leg of trip.start.legs.filter((item) => item.type === "walk")) {
    const model = await store.level(building.key, leg.level);
    for (const point of leg.coordinates.slice(1, -1)) assert.ok(model.corridors.some((rings) => pointInRings(point, rings)), `${leg.level}: the route stays in the corridor`);
  }
  const summary = describeTrip({ ...trip, destinationName: to.name, buildingName: () => "Secretariat Building", levelShort: (key, id) => building.levelById.get(id).short });
  assert.equal(summary.status, "ok");
  assert.match(summary.headline, /^\d+ min · \d+ m$/);
  assert.deepEqual(summary.steps.map((step) => step.title), ["Walk to Lift A", "Take Lift A up to L6", `Walk to ${to.name}`]);
  assert.equal(summary.navigable, false, "an indoor route has no GPS guidance");

  // From outside: the route enters by the entrance nearest the outdoor route's end.
  const entrance = org.places.find((place) => place.building === building.key && place.class === "entrance");
  const arriving = await planIndoorTrip({ store, source: { key: null, uid: null, door: null }, destination: { key: building.key, uid: to.uid, door: entrance.point } });
  assert.equal(arriving.start, null);
  assert.equal(arriving.end.legs[0].level, "L01");
  assert.equal(arriving.end.from.entrance, true);
  const stepFree = await planIndoorTrip({ store, stepFree: true, sameBuilding: true, source: { key: building.key, uid: find("L01", "Reception").uid, door: null }, destination: { key: building.key, uid: org.places.find((place) => place.building === building.key && place.level === "L02" && place.kind === "unit").uid, door: null } });
  assert.equal(stepFree.start.legs.find((leg) => leg.type === "connector").class, "lift");
});

test("every room and point of every floor plan can be routed to", async () => {
  for (const id of listOrganisations(root)) {
    const { org, store } = storeOf(id);
    for (const place of org.places) {
      const anchor = await store.placeAnchor(place.uid);
      assert.ok(anchor, `${id}: ${place.uid} (${place.name}) is beside a walkable area`);
    }
    for (const building of store.buildings) assert.ok(await store.entranceAnchor(building.key), `${id}/${building.entry.folder}: an entrance`);
  }
});
