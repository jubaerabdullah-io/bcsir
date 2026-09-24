// Campus directory (laboratories and testing services), search, and the
// service -> laboratory -> building mapping.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeBuildings } from "../src/bcsir-data.js";
import { createDirectory, displaySampleType, formatDuration, formatFee, LAB_TYPE_LABELS, normalizeText } from "../src/directory.js";
import { INARS_SOURCE, inarsRecords, parseTables } from "../scripts/import-inars-services.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const readJSON = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const buildings = normalizeBuildings(readJSON("public/data/BuildingBoundary.geojson"));
const labsFile = readJSON("public/data/directory/laboratories.json");
const servicesFile = readJSON("public/data/directory/testing-services.json");
const directory = createDirectory({ buildings, laboratories: labsFile.laboratories, services: servicesFile.services, sources: servicesFile.sources });
const buildingIds = new Set(buildings.features.map((feature) => String(feature.properties.id)));

test("laboratories.json: unique ids, known types, existing parents and buildings, a source for every record", () => {
  const labs = labsFile.laboratories;
  assert.equal(labsFile.schema, "bcsir-laboratories/1");
  assert.equal(new Set(labs.map((lab) => lab.id)).size, labs.length, "unique ids");
  const ids = new Set(labs.map((lab) => lab.id));
  for (const lab of labs) {
    assert.ok(LAB_TYPE_LABELS[lab.type], `${lab.id}: type ${lab.type}`);
    assert.ok(lab.name && lab.name.trim(), `${lab.id}: name`);
    assert.match(lab.source_url, /^https:\/\/[a-z0-9.-]+\.bcsir\.gov\.bd\//, `${lab.id}: official BCSIR source`);
    if (lab.parent_id) assert.ok(ids.has(lab.parent_id), `${lab.id}: parent ${lab.parent_id} exists`);
    if (lab.building_id !== undefined && lab.building_id !== null) assert.ok(buildingIds.has(String(lab.building_id)), `${lab.id}: building ${lab.building_id} exists`);
    assert.ok(directory.labLocation(lab.id), `${lab.id}: a building is recorded for it or its parent`);
  }
});

test("institutes are mapped to the building that carries their name", () => {
  for (const lab of labsFile.laboratories.filter((item) => item.type === "institute")) {
    const building = buildings.features.find((feature) => String(feature.properties.id) === String(lab.building_id)).properties;
    assert.equal(normalizeText(building.name_en), normalizeText(lab.name), `${lab.id} -> building ${lab.building_id}`);
    if (lab.short_name) assert.equal(building.name_en_short, lab.short_name);
  }
  // INARS: the building's own site_url is the institute site the services were published on.
  const inars = buildings.features.find((feature) => feature.properties.id === 102).properties;
  assert.equal(new URL(inars.site_url).hostname, new URL(INARS_SOURCE.url).hostname);
});

test("testing-services.json: every record is complete, linked to a laboratory and a named source", () => {
  const services = servicesFile.services;
  assert.equal(servicesFile.schema, "bcsir-testing-services/1");
  assert.equal(new Set(services.map((service) => service.id)).size, services.length, "unique ids");
  const labIds = new Set(labsFile.laboratories.map((lab) => lab.id));
  const sources = new Map(servicesFile.sources.map((source) => [source.id, source]));
  for (const service of services) {
    assert.ok(service.name && service.sample_type && service.method, `${service.id}: name, sample type and method`);
    assert.ok(labIds.has(service.laboratory_id), `${service.id}: laboratory ${service.laboratory_id}`);
    assert.ok(sources.has(service.source), `${service.id}: source ${service.source}`);
    assert.match(service.source_ref, /^SI \d+$/, `${service.id}: row reference`);
    assert.ok(service.fee_bdt === null || service.fee_bdt > 0);
  }
  const inars = sources.get("inars-service-charges");
  assert.equal(inars.records, services.filter((service) => service.source === "inars-service-charges").length);
  assert.match(inars.retrieved, /^\d{4}-\d{2}-\d{2}$/);
});

test("building search keeps the original fields: English, short and Bengali names, alias and ID", () => {
  assert.equal(directory.search("Pilot Plant").results[0].title, "Pilot Plant & Process Development Centre");
  assert.equal(directory.search("INARS").results[0].buildingId, "102");
  assert.equal(directory.search("102").results[0].buildingId, "102");
  assert.equal(directory.search("জিনোমিক").results[0].buildingId, "101");
  assert.equal(directory.search("Chemical Storage").results[0].buildingId, "103"); // alias
  assert.deepEqual(directory.search("").results, []);
});

test("laboratory search finds research divisions and sections", () => {
  const analytical = directory.search("Analytical").results;
  const labs = analytical.filter((entry) => entry.kind === "lab").map((entry) => entry.title).sort();
  assert.deepEqual(labs, ["Environmental Analytical Research Division", "Inorganic Analytical Research Division", "Organic Analytical Research Division"]);
  assert.ok(analytical.some((entry) => entry.kind === "building" && entry.buildingId === "102"));
  assert.ok(analytical.every((entry) => entry.kind !== "test"), "the lab name alone does not list every test");
  const micro = directory.search("microbiology").results;
  assert.ok(micro.length >= 3 && micro.every((entry) => entry.kind === "lab" && entry.buildingId === "111"));
  // A division without its own building uses its institute's building, and says so.
  const division = directory.entry("lab:inars-organic-analytical-research-division");
  assert.equal(division.buildingId, "102");
  assert.equal(division.locatedVia.id, "inars");
});

test("test search: 'Calcium' lists the published Calcium tests with their sample types", () => {
  const calcium = directory.search("Calcium").results;
  assert.equal(calcium.length, 8);
  assert.ok(calcium.every((entry) => entry.kind === "test" && /^calcium/i.test(entry.title)));
  const samples = calcium.map((entry) => entry.subtitle);
  for (const sample of ["Sludge/Sediment", "Drinks/Beverage", "Water/Drinking water/Surface water/River water/S"]) assert.ok(samples.includes(sample), sample);
  // Every test is linked through its laboratory to that laboratory's building.
  for (const entry of calcium) {
    assert.equal(entry.lab.id, entry.record.laboratory_id);
    assert.equal(entry.buildingId, directory.labLocation(entry.record.laboratory_id).buildingId);
  }
  assert.equal(directory.search("calcium water").results.length, 2, "words narrow the list");
  assert.equal(directory.search("calcium inars").results.length, 8, "the laboratory name refines");
});

test("a service with its own building_id uses it; an unmapped laboratory gives no building", () => {
  const custom = createDirectory({
    buildings,
    laboratories: [
      { id: "inst", name: "Test Institute", type: "institute", building_id: 110, source_url: "https://example.bcsir.gov.bd/" },
      { id: "floating", name: "Unmapped Unit", type: "laboratory", source_url: "https://example.bcsir.gov.bd/" }
    ],
    services: [
      { id: "s1", name: "Zeta potential", sample_type: "Powder", method: "DLS", laboratory_id: "inst", source: "x", source_ref: "SI 1" },
      { id: "s2", name: "Zeta potential", sample_type: "Slurry", method: "DLS", laboratory_id: "inst", building_id: 108, source: "x", source_ref: "SI 2" },
      { id: "s3", name: "Zeta potential", sample_type: "Liquid", method: "DLS", laboratory_id: "floating", source: "x", source_ref: "SI 3" }
    ]
  });
  const byId = Object.fromEntries(custom.search("zeta").results.map((entry) => [entry.id, entry]));
  assert.equal(byId.s1.buildingId, "110");
  assert.equal(byId.s2.buildingId, "108");
  assert.equal(byId.s3.buildingId, null);
  assert.match(byId.s3.meta, /Location not recorded/);
  assert.equal(custom.building(byId.s3.buildingId), null);
});

test("identical published rows are listed once", () => {
  const tin = directory.search("Tin").results.filter((entry) => entry.subtitle === "Vegetables" && /^tin/i.test(entry.title));
  assert.equal(tin.length, 1);
});

test("text helpers", () => {
  assert.equal(normalizeText("Calcium (Ca)"), "calcium ca");
  assert.equal(normalizeText("Pilot Plant & Process"), "pilot plant and process");
  assert.equal(displaySampleType("Feed-(INARS)"), "Feed");
  assert.equal(displaySampleType("Drinks/Beverage -(INARS)"), "Drinks/Beverage");
  assert.equal(displaySampleType("Sludge/Sediment-1"), "Sludge/Sediment");
  assert.equal(formatFee({ fee_bdt: 2500 }), "2,500 BDT");
  assert.equal(formatFee({ fee_bdt: null }), null);
  assert.equal(formatDuration({ duration_days: 7 }), "7 days");
});

test("INARS import keeps table rows verbatim and rejects a changed layout", () => {
  const html = `<table><tr><th>SI</th><th>Name of Sample</th><th>Test Parameter</th><th>Methodology</th><th>Fees</th><th>Duration</th></tr>
    <tr><td>517</td><td rowspan="2">Sludge/Sediment-1</td><td>Calcium (Ca)</td><td>APHA method 3IIID</td><td>3000.00</td><td>10</td></tr>
    <tr><td>518</td><td>Chromium  (Cr)</td><td>APHA method 3II3B</td><td></td><td>10</td></tr></table>`;
  assert.deepEqual(parseTables(html)[0][2], ["518", "Sludge/Sediment-1", "Chromium (Cr)", "APHA method 3II3B", "", "10"]);
  const records = inarsRecords(html);
  assert.deepEqual(records[0], { id: "inars-517", name: "Calcium (Ca)", sample_type: "Sludge/Sediment-1", method: "APHA method 3IIID", fee_bdt: 3000, duration_days: 10, laboratory_id: "inars", source: "inars-service-charges", source_ref: "SI 517" });
  assert.equal(records[1].fee_bdt, null);
  assert.throws(() => inarsRecords(html.replace("Test Parameter", "Parameter")), /layout changed/);
});
