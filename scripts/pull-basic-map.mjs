#!/usr/bin/env node
// Usage:
//   npm run data:pull-2d
//
// Brings the data of the Basic 2D map up to date. That map is drawn from the
// original QGIS repository (the flat layers, without the heights, photos and
// models added to public/data/bcsir/ for the 3D map):
//
//   https://github.com/mohammadrhoque/bcsir-qgis-map
//
// The repository is private, so neither a browser nor the GitHub Pages build
// can read it. This script copies its files into public/data/bcsir-2d/, where
// they are committed with the site:
//   1. clones the repository into a temporary folder (with your own git login);
//   2. copies the six GeoJSON layers and the routing network, unchanged;
//   3. converts the Garden and TreeLine shapefiles to GeoJSON (the same
//      conversion as `npm run data:prepare`; colours already set are kept);
//   4. writes source.json (repository, commit) and, only if it is missing, org.json.
// Nothing outside public/data/bcsir-2d/ is written.
//
// Another repository or branch:
//   npm run data:pull-2d -- --repo https://github.com/<user>/<repo> --branch main
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCopy, DATASETS } from "./lib/public-data.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback; };

const REPOSITORY = option("repo", "https://github.com/mohammadrhoque/bcsir-qgis-map");
const BRANCH = option("branch", "");
const TARGET = "public/data/bcsir-2d";
// Copied byte for byte.
const FILES = [
  "BCSIRBoundary.geojson",
  "BuildingBoundary.geojson",
  "ConnectedRoad.geojson",
  "ConnectedRoadsDrawingVersion.geojson",
  "InternalBoundary.geojson",
  "Pathway.geojson",
  "ConnectedRoads/v0/r2.json"
];
// Written only when the folder has no org.json yet; edit it freely afterwards.
const ORG = {
  name: "Bangladesh Council of Scientific and Industrial Research",
  short_name: "BCSIR 2D",
  tagline: "2D map of the Science Laboratory campus, Dhaka",
  logo: "logo.png",
  image_folder: "bcsir",
  view_mode: "2d",
  accent: "#0f766e",
  order: 3,
  view: { center: [90.38612, 23.74024], zoom: 16.6, pitch: 0, bearing: 0 },
  search_placeholder: "Search buildings...",
  // The site boundary has its own name in the QGIS repository; the other files have the usual names.
  datasets: { boundary: "BCSIRBoundary.geojson" }
};

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const clone = mkdtempSync(path.join(os.tmpdir(), "bcsir-2d-"));
try {
  console.log(`Reading ${REPOSITORY}${BRANCH ? ` (${BRANCH})` : ""} ...`);
  try {
    git(["clone", "--depth", "1", ...(BRANCH ? ["--branch", BRANCH] : []), REPOSITORY, clone]);
  } catch (error) {
    console.error(`The repository could not be read:\n${String(error.stderr || error.message).trim()}\n\nIt is private: sign in to GitHub with an account that can open it (for example run "git ls-remote ${REPOSITORY}" once and sign in), then run this again.`);
    process.exit(1);
  }

  // Check everything before anything is written.
  const missing = FILES.filter((file) => !existsSync(path.join(clone, file)));
  if (missing.length) { console.error(`Not in the repository: ${missing.join(", ")}. Nothing was changed.`); process.exit(1); }
  for (const file of FILES) {
    const data = JSON.parse(readFileSync(path.join(clone, file), "utf8"));
    if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) { console.error(`${file} is not a GeoJSON FeatureCollection. Nothing was changed.`); process.exit(1); }
  }

  const target = path.join(root, TARGET);
  const changed = [];
  const write = (relative, content) => {
    const file = path.join(target, relative);
    const before = existsSync(file) ? readFileSync(file) : null;
    if (before && Buffer.compare(before, Buffer.from(content)) === 0) return;
    mkdirSync(path.dirname(file), { recursive: true });
    if (Buffer.isBuffer(content)) writeFileSync(file, content); else writeFileSync(file, content, "utf8");
    changed.push(relative);
  };

  for (const file of FILES) write(file, readFileSync(path.join(clone, file)));
  for (const dataset of DATASETS) {
    if (!existsSync(path.join(clone, `${dataset.shapefile}.shp`))) continue;
    const name = `${dataset.name}.geojson`;
    const existing = existsSync(path.join(target, name)) ? readFileSync(path.join(target, name), "utf8") : null;
    write(name, await buildCopy(clone, dataset, existing));
  }
  write("source.json", `${JSON.stringify({ repository: REPOSITORY, commit: git(["rev-parse", "HEAD"], clone), committed: git(["log", "-1", "--format=%cI"], clone), message: git(["log", "-1", "--format=%s"], clone) }, null, 2)}\n`);
  if (!existsSync(path.join(target, "org.json"))) write("org.json", `${JSON.stringify(ORG, null, 2)}\n`);

  console.log(changed.length ? `Updated ${TARGET}/:\n  ${changed.join("\n  ")}` : `${TARGET}/ is already up to date.`);
} finally {
  rmSync(clone, { recursive: true, force: true });
}
