// The catalog of organisations, built from the folders in public/data/.
//
// A browser cannot list folders, so this module reads them (in `npm run dev` on
// every request, in `npm run build` once) and writes what the map needs to know:
//
//   data/catalog.json        every organisation: name, logo, start view, counts.
//                            Read by the organisation picker.
//   data/<org>/index.json    one organisation: its dataset files, its photos, its
//                            buildings with floors (folders, floor order, files)
//                            and the search list of rooms and points.
//
// Nothing here is written into public/: the Vite plugin serves the two files in
// development and adds them to dist/ at build time, so adding a building is only
// "create the folder, save the GeoJSON files".
//
// Folder layout (see README "Organisations and floors"):
//
//   public/data/<org>/org.json                        name, logo, start view, options
//   public/data/<org>/<dataset>.geojson               site layers (buildings, roads, ...)
//   public/data/<org>/<building folder>/building.json optional { "building_id": 127 }
//   public/data/<org>/<building folder>/L01/*.geojson one folder per floor
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { labelAnchor, pointInRings } from "../../src/geo-utils.js";
import { featureKeys, featureName, firstProperty, folderKey, isConnectorClass, levelFileKind, parseLevelFolder, placeUid, poiClass, sortLevels, unitClass } from "../../src/indoor/levels.js";

export const DATA_DIR = "public/data";
export const IMAGE_DIR = "public/image";
export const MODELS_DIR = "public/models";
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|svg)$/i;
const ORG_ID = /^[a-z0-9][a-z0-9_-]*$/;

// File names looked for when org.json does not name a dataset's file
// (capitalisation ignored). An organisation only needs the files it has.
export const DATASET_FILES = {
  area: ["area.geojson", "sitearea.geojson"],
  boundary: ["boundary.geojson", "siteboundary.geojson", "site.geojson"],
  buildings: ["buildings.geojson", "buildingboundary.geojson", "building.geojson"],
  roads: ["roads.geojson", "road.geojson", "connectedroad.geojson"],
  roadsDrawing: ["roadsdrawing.geojson", "connectedroadsdrawingversion.geojson"],
  pathways: ["pathways.geojson", "pathway.geojson", "paths.geojson"],
  internal: ["internalboundary.geojson", "internal.geojson", "sitewalls.geojson"],
  garden: ["garden.geojson", "gardens.geojson", "green.geojson"],
  treeLine: ["treeline.geojson", "trees.geojson"],
  models: ["models.geojson"],
  gardenModels: ["gardenmodels.geojson"],
  treeLineModels: ["treelinemodels.geojson"],
  network: ["network.json", "network.geojson", "connectedroads/v0/r2.json"]
};

const toPosix = (value) => value.split(path.sep).join("/");
const isDirectory = (target) => { try { return statSync(target).isDirectory(); } catch { return false; } };

function readJSON(file, problems, label) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { problems?.push(`${label}: ${error.code === "ENOENT" ? "file not found" : `not valid JSON (${error.message})`}`); return null; }
}

function filesIn(directory, pattern) {
  if (!isDirectory(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => toPosix(path.relative(directory, path.join(entry.parentPath ?? entry.path, entry.name))))
    .sort();
}

// Organisation ids: the folders of public/data/ that hold an org.json or a GeoJSON file.
export function listOrganisations(root) {
  const directory = path.join(root, DATA_DIR);
  if (!isDirectory(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
    .filter((entry) => {
      const files = readdirSync(path.join(directory, entry.name));
      return files.includes("org.json") || files.some((file) => /\.geojson$/i.test(file));
    })
    .map((entry) => entry.name)
    .sort();
}

function resolveDatasets(directory, config, problems) {
  const present = new Map(filesIn(directory, /\.(geo)?json$/i).map((file) => [file.toLowerCase(), file]));
  const datasets = {};
  for (const [key, candidates] of Object.entries(DATASET_FILES)) {
    const named = config.datasets?.[key];
    if (named) {
      const found = present.get(String(named).toLowerCase());
      if (found) datasets[key] = found;
      else problems.push(`org.json: datasets.${key} names "${named}", which is not in the organisation's data folder`);
      continue;
    }
    const found = candidates.map((candidate) => present.get(candidate)).find(Boolean);
    if (found) datasets[key] = found;
  }
  return datasets;
}

const collectionOf = (data) => (data?.type === "FeatureCollection" && Array.isArray(data.features) ? data.features : []);
const polygonsOf = (geometry) => (geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : []);
const round7 = (value) => Math.round(value * 1e7) / 1e7;

function extend(bbox, geometry) {
  const visit = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number") {
      if (coordinates[0] < bbox[0]) bbox[0] = coordinates[0];
      if (coordinates[1] < bbox[1]) bbox[1] = coordinates[1];
      if (coordinates[0] > bbox[2]) bbox[2] = coordinates[0];
      if (coordinates[1] > bbox[3]) bbox[3] = coordinates[1];
      return;
    }
    coordinates.forEach(visit);
  };
  visit(geometry?.coordinates);
}

// Search point of a feature: a Point's own position, a polygon's label point.
function featurePoint(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;
  if (geometry.type === "Point") return geometry.coordinates.slice(0, 2);
  if (geometry.type === "MultiPoint") return geometry.coordinates[0]?.slice(0, 2) || null;
  const point = labelAnchor(feature);
  return point ? point.slice(0, 2) : null;
}

// One floor folder: its files by kind, its names and the searchable places in it.
function scanLevel(directory, folder, { buildingKey, where, problems, places }) {
  const parsed = parseLevelFolder(folder);
  const files = readdirSync(path.join(directory, folder)).filter((file) => /\.geojson$/i.test(file)).sort();
  if (!parsed || !files.length) return null;
  const level = { ...parsed, files: { level: null, corridor: [], walls: [], pois: [], doors: [], units: [] } };
  const outline = [];
  for (const file of files) {
    const { kind, unitClass: fileClass } = levelFileKind(file);
    const label = `${where}/${folder}/${file}`;
    const features = collectionOf(readJSON(path.join(directory, folder, file), problems, label));
    if (kind === "level") {
      level.files.level = file;
      const properties = features[0]?.properties || {};
      const name = featureName(properties);
      const short = firstProperty(properties, ["short_name", "short", "label_short"]);
      const ordinal = Number(firstProperty(properties, ["ordinal", "z_index", "level_index"]));
      if (name) level.name = name;
      if (short !== undefined) level.short = String(short).trim();
      if (Number.isFinite(ordinal) && firstProperty(properties, ["ordinal", "z_index", "level_index"]) !== undefined) level.ordinal = ordinal;
      if (properties.is_default === true || properties.is_default === "true" || properties.is_default === 1) level.is_default = true;
      const building = firstProperty(properties, ["building_id", "building"]);
      if (building !== undefined) level.building_id = String(building);
      features.forEach((feature) => outline.push(feature));
      continue;
    }
    if (kind === "units") level.files.units.push({ file, class: fileClass });
    else level.files[kind].push(file);
    if (kind !== "units" && kind !== "pois") continue;
    const keys = featureKeys(features);
    features.forEach((feature, index) => {
      const properties = feature.properties || {};
      const name = featureName(properties);
      const type = kind === "units" ? unitClass(properties, fileClass) : poiClass(properties);
      // Rooms are listed when they are named; points when named or of a known kind.
      if (kind === "units" ? !name : !name && type === "poi") return;
      const point = featurePoint(feature);
      if (!point || !point.every(Number.isFinite)) { problems.push(`${label} feature ${keys[index]}: no usable geometry`); return; }
      const place = { uid: placeUid(buildingKey, folder, file, keys[index]), kind: kind === "units" ? "unit" : "poi", name, class: type, building: buildingKey, level: folder, point: point.map(round7) };
      const bangla = firstProperty(properties, ["name_bn"]);
      if (bangla !== undefined) place.name_bn = String(bangla);
      const keywords = firstProperty(properties, ["keywords", "tags", "alias", "name_en_alias"]);
      if (keywords !== undefined) place.keywords = String(keywords);
      const number = firstProperty(properties, ["unit_number", "room_number", "room_no", "number"]);
      if (number !== undefined) place.number = String(number);
      if (kind === "pois" && isConnectorClass(type)) {
        place.connector = type;
        const shaft = firstProperty(properties, ["connector_id", "connects", "shaft", "shaft_id"]);
        if (shaft !== undefined) place.connector_id = String(shaft);
      }
      places.push(place);
    });
  }
  return { level, outline };
}

// Building of a floor outline: the footprint that contains the outline's label point.
function buildingAt(features, buildings) {
  for (const feature of features) {
    const point = featurePoint(feature);
    if (!point) continue;
    const hit = buildings.find((building) => polygonsOf(building.geometry).some((rings) => pointInRings(point, rings)));
    if (hit) return hit;
  }
  return null;
}

function scanIndoor(directory, buildings, problems) {
  const indoor = [];
  const places = [];
  const usedKeys = new Set();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const folder = entry.name;
    const buildingDirectory = path.join(directory, folder);
    const levelFolders = readdirSync(buildingDirectory, { withFileTypes: true }).filter((item) => item.isDirectory() && parseLevelFolder(item.name));
    if (!levelFolders.length) continue;
    let key = folderKey(folder);
    while (usedKeys.has(key)) key = `${key}-2`;
    usedKeys.add(key);
    const config = existsSync(path.join(buildingDirectory, "building.json")) ? readJSON(path.join(buildingDirectory, "building.json"), problems, `${folder}/building.json`) || {} : {};
    const levels = [];
    const outlines = [];
    const bbox = [Infinity, Infinity, -Infinity, -Infinity];
    let levelBuildingId;
    for (const item of levelFolders) {
      const scanned = scanLevel(buildingDirectory, item.name, { buildingKey: key, where: folder, problems, places });
      if (!scanned) continue;
      levels.push(scanned.level);
      if (scanned.level.building_id !== undefined) { levelBuildingId ??= scanned.level.building_id; delete scanned.level.building_id; }
      scanned.outline.forEach((feature) => { outlines.push(feature); extend(bbox, feature.geometry); });
      if (!scanned.level.files.level) problems.push(`${folder}/${item.name}: no level.geojson (the floor outline); the building footprint is used instead`);
      if (!scanned.level.files.corridor.length) problems.push(`${folder}/${item.name}: no corridor.geojson; routes on this floor use every part of the floor that is not a room`);
    }
    if (!levels.length) continue;
    const ordinals = new Map();
    for (const level of levels) {
      if (ordinals.has(level.ordinal)) problems.push(`${folder}: floors ${ordinals.get(level.ordinal)} and ${level.id} have the same number (${level.ordinal})`);
      ordinals.set(level.ordinal, level.id);
    }
    // Which building this is: building.json, else a building_id in level.geojson,
    // else the footprint that contains the floor outline.
    const explicit = config.building_id ?? levelBuildingId;
    let building = null;
    if (explicit !== undefined && explicit !== null) {
      building = buildings.find((feature) => String(feature.properties?.id) === String(explicit)) || null;
      if (!building) problems.push(`${folder}: building_id ${JSON.stringify(explicit)} is not in the buildings file`);
    } else {
      building = buildingAt(outlines, buildings);
      if (!building && buildings.length) problems.push(`${folder}: the floor outline lies in no building footprint; add building.json with { "building_id": ... }`);
    }
    const properties = building?.properties || {};
    const center = building ? featurePoint(building) : Number.isFinite(bbox[0]) ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null;
    indoor.push({
      key,
      folder,
      building_id: building ? String(properties.id) : null,
      name: String(config.name || properties.name_en || folder).trim(),
      short_name: String(config.short_name || properties.name_en_short || "").trim() || null,
      sample: config.sample === true,
      center: center ? center.map(round7) : null,
      bbox: Number.isFinite(bbox[0]) ? bbox.map(round7) : null,
      levels: sortLevels(levels)
    });
  }
  indoor.sort((a, b) => a.name.localeCompare(b.name));
  return { indoor, places };
}

// Everything the map needs to know about one organisation.
export function buildOrgIndex(root, id) {
  const directory = path.join(root, DATA_DIR, id);
  const problems = [];
  if (!ORG_ID.test(id)) problems.push(`The folder name "${id}" is used in web addresses: use lower-case letters, digits, "-" and "_" only`);
  const config = existsSync(path.join(directory, "org.json")) ? readJSON(path.join(directory, "org.json"), problems, "org.json") || {} : {};
  const datasets = resolveDatasets(directory, config, problems);
  const buildings = datasets.buildings ? collectionOf(readJSON(path.join(directory, datasets.buildings), problems, datasets.buildings)) : [];
  const { indoor, places } = scanIndoor(directory, buildings, problems);
  // Photos come from the organisation's own folder, or from the one org.json names
  // ("image_folder": "bcsir": two maps of the same site share one set of photos).
  let imageFolder = id;
  if (config.image_folder !== undefined) {
    if (ORG_ID.test(String(config.image_folder)) && isDirectory(path.join(root, IMAGE_DIR, String(config.image_folder)))) imageFolder = String(config.image_folder);
    else problems.push(`org.json: image_folder "${config.image_folder}" is not a folder in ${IMAGE_DIR}/`);
  }
  const images = filesIn(path.join(root, IMAGE_DIR, imageFolder), IMAGE_EXTENSIONS);
  const directoryFiles = {};
  for (const [key, file] of Object.entries(config.directory || {})) {
    if (existsSync(path.join(directory, file))) directoryFiles[key] = file;
    else problems.push(`org.json: directory.${key} names "${file}", which is not in the organisation's data folder`);
  }
  const logo = config.logo && images.find((file) => file.toLowerCase() === String(config.logo).toLowerCase());
  if (config.logo && !logo) problems.push(`org.json: logo "${config.logo}" is not in ${IMAGE_DIR}/${imageFolder}/`);
  const name = String(config.name || id).trim();
  return {
    ...config,
    id,
    image_folder: imageFolder === id ? undefined : imageFolder,
    name,
    short_name: String(config.short_name || name).trim(),
    logo: logo || null,
    datasets,
    directory: Object.keys(directoryFiles).length ? directoryFiles : null,
    images,
    has_model_manifest: existsSync(path.join(root, MODELS_DIR, id, "lod", "manifest.json")),
    indoor,
    places,
    stats: {
      buildings: buildings.length,
      indoor_buildings: indoor.length,
      floors: indoor.reduce((sum, building) => sum + building.levels.length, 0),
      places: places.filter((place) => place.kind === "unit").length
    },
    problems
  };
}

// The picker's list: one short entry per organisation, in `order` then by name.
export function buildCatalog(root) {
  const organisations = listOrganisations(root).map((id) => {
    const index = buildOrgIndex(root, id);
    return {
      id,
      name: index.name,
      short_name: index.short_name,
      tagline: index.tagline || null,
      logo: index.logo,
      ...(index.image_folder ? { image_folder: index.image_folder } : {}),
      accent: index.accent || null,
      sample: index.sample === true,
      default: index.default === true,
      order: Number.isFinite(Number(index.order)) ? Number(index.order) : 1000,
      view: index.view || null,
      stats: index.stats
    };
  }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return { organisations };
}
