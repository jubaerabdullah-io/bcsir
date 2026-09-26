// Short, friendly building names for the walk-mode minimap (src/short-names.js).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shortBuildingName, wrapName } from "../src/short-names.js";

const buildings = JSON.parse(readFileSync(new URL("../public/data/BuildingBoundary.geojson", import.meta.url), "utf8"));
const byId = (id) => buildings.features.find((feature) => feature.properties.id === id).properties;

test("minimap names: the data's short name, else a friendly short form of the full name", () => {
  assert.equal(shortBuildingName(byId(102)), "INARS", "name_en_short first");
  assert.equal(shortBuildingName(byId(101)), "Genomic Lab");
  assert.equal(shortBuildingName(byId(214)), "Quarter 07");
  assert.equal(shortBuildingName(byId(203)), "Central Mosque", "no BCSIR prefix");
  assert.equal(shortBuildingName(byId(220)), "Garage", "no (near …) note");
  assert.equal(shortBuildingName(byId(119)), "IBSPS", "a long institute name becomes its initials");
  assert.equal(shortBuildingName(byId(134)), "Near Glass House", "lower-case names are capitalised");
  assert.equal(shortBuildingName({}), "");
  for (const feature of buildings.features) {
    const name = shortBuildingName(feature.properties);
    assert.ok(name && name.length <= 26, `${feature.properties.id}: "${name}"`);
    const lines = wrapName(name);
    assert.ok(lines.length <= 2 && lines.join(" ") === name, `${feature.properties.id}: ${lines.join(" / ")}`);
  }
  assert.deepEqual(wrapName("Innovation Gallery"), ["Innovation", "Gallery"]);
  assert.deepEqual(wrapName("Res. Quarters 2"), ["Res. Quarters 2"], "up to 15 characters on one line");
});
