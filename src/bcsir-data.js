// Loads the BCSIR datasets from public/data/ and prepares in-memory RENDER copies.
//
// Adapted from the reference project's loadIndoorData()/normalizeGeoJSON():
// each file is loaded independently so one bad file cannot block the others,
// and the last valid copy is kept if a reload fails (e.g. while QGIS is saving).
//
// Every visual value is read from the feature's own properties
// (base_m, top_m, thickness_m, color, ...) and validated in
// visual-properties.js; config.js only supplies fallbacks.
//
// Guarantees:
// - Geometry coordinates are passed through unchanged (no rounding, no reprojection).
// - Original properties are kept; render-only values use the `render_` prefix.
// - Nothing is written back to any file.
import { BUILDING_CATEGORIES, DATA_PATHS, HEIGHT_FIELDS, LAYER_DEFAULTS, METRES_PER_LEVEL } from "./config.js";
import { labelAnchor } from "./geo-utils.js";
import { publicAssetUrl } from "./paths.js";
import { createReport, parseColor, parseNumber, resolveVisual } from "./visual-properties.js";

const POLYGONS = ["Polygon", "MultiPolygon"];
const LINES = ["LineString", "MultiLineString"];
const POINTS = ["Point", "MultiPoint"];

// Geometry types drawn by each dataset's MapLibre/Three.js layers. Point and
// MultiPoint features are also accepted everywhere: they can carry a `model`.
const GEOMETRY_RULES = {
  boundary: POLYGONS,
  buildings: POLYGONS,
  roads: LINES,
  roadsDrawing: LINES,
  pathways: LINES,
  internal: LINES,
  garden: POLYGONS,
  treeLine: LINES
};

export const DATASET_LABELS = {
  boundary: "BCSIRBoundary.geojson",
  buildings: "BuildingBoundary.geojson",
  roads: "ConnectedRoad.geojson",
  roadsDrawing: "ConnectedRoadsDrawingVersion.geojson",
  pathways: "Pathway.geojson",
  internal: "InternalBoundary.geojson",
  garden: "Garden.geojson",
  treeLine: "TreeLine.geojson",
  models: "models.geojson",
  gardenModels: "GardenModels.geojson",
  treeLineModels: "TreeLineModels.geojson",
  network: "ConnectedRoads/v0/r2.json"
};

// Case-insensitive property lookup (reference: firstProperty()).
function firstProperty(properties, names) {
  const normalized = new Map(Object.entries(properties || {}).map(([key, value]) => [String(key).toLowerCase().trim(), value]));
  for (const name of names) {
    const value = normalized.get(name.toLowerCase());
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

// Reference: shade() from indoor-base.js. Used to draw building walls slightly
// darker than their roof so the 3D shape reads clearly.
function shade(value, factor = 0.86) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value));
  if (!match) return value;
  const hex = match[1];
  const channel = (offset) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(offset, offset + 2), 16) * factor)));
  return `#${[0, 2, 4].map((offset) => channel(offset).toString(16).padStart(2, "0")).join("")}`;
}

function hash(text) {
  let result = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    result ^= text.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export async function fetchDataset(key, { fresh = false } = {}) {
  const url = publicAssetUrl(DATA_PATHS[key]);
  const response = await fetch(fresh ? `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}` : url, fresh ? { cache: "no-store" } : undefined);
  if (!response.ok) throw new Error(`${DATASET_LABELS[key]}: ${response.status} ${response.statusText}`);
  const text = await response.text();
  const data = JSON.parse(text);
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error(`${DATASET_LABELS[key]} must be a GeoJSON FeatureCollection.`);
  }
  return { data, signature: hash(text) };
}

// Keep the features this dataset draws. Point/MultiPoint features are silently
// left to the 3D model system; anything else is reported.
function filterGeometry(key, data) {
  let skipped = 0;
  const features = data.features.filter((feature) => {
    const type = feature?.geometry?.type;
    if (GEOMETRY_RULES[key].includes(type)) return true;
    if (!POINTS.includes(type)) skipped += 1;
    return false;
  });
  if (skipped) console.warn(`${DATASET_LABELS[key]}: ${skipped} feature(s) skipped because of missing or unsupported geometry.`);
  return { type: "FeatureCollection", features, _skippedFeatures: skipped };
}

const featureLabel = (feature, index) => feature?.properties?.id ?? feature?.id ?? `#${index + 1}`;

// Building category (used for the legend label and card chip): the legacy
// QGIS `color` code when present, otherwise the `area` attribute.
function buildingCategory(properties) {
  const code = typeof properties.color === "string" ? properties.color.trim() : "";
  if (BUILDING_CATEGORIES[code]) return code;
  if (properties.area === "office") return "o";
  if (properties.area === "residential") return "r";
  return "other";
}

// Heights come from base_m / top_m. Older height fields are used only when
// top_m is absent. heightScale is the layer panel's visual exaggeration (1 = exact).
export function resolveBuildingHeight(properties, { report, featureId } = {}) {
  const defaults = LAYER_DEFAULTS.buildings;
  let source = "top_m";
  let input = properties;
  const hasTop = parseNumber(properties.top_m) !== null;
  if (!hasTop && properties.top_m === undefined) {
    const aliasTop = parseNumber(firstProperty(properties, HEIGHT_FIELDS.top));
    const aliasBase = parseNumber(firstProperty(properties, HEIGHT_FIELDS.base));
    const levels = parseNumber(firstProperty(properties, HEIGHT_FIELDS.levels));
    const base = parseNumber(properties.base_m) ?? aliasBase ?? 0;
    if (aliasTop !== null) { input = { ...properties, base_m: base, top_m: aliasTop }; source = "height attribute"; }
    else if (levels !== null && levels > 0) { input = { ...properties, base_m: base, top_m: base + levels * METRES_PER_LEVEL }; source = "levels"; }
    else source = "default";
  }
  const visual = resolveVisual(input, defaults, { report, featureId, legacyColorCodes: true });
  if (hasTop && visual.topM !== parseNumber(properties.top_m)) source = "default";
  return { base: visual.baseM, top: visual.topM, color: visual.color, source };
}

export function normalizeBuildings(raw, heightScale = 1) {
  const filtered = filterGeometry("buildings", raw);
  const report = createReport(DATASET_LABELS.buildings);
  const seen = new Map();
  const features = filtered.features.map((feature, index) => {
    const properties = { ...(feature.properties || {}) };
    const originalId = String(properties.id ?? feature.id ?? `building_${index + 1}`);
    const count = seen.get(originalId) || 0;
    seen.set(originalId, count + 1);
    const renderId = count ? `${originalId}__${count + 1}` : originalId;
    const { base, top, color, source } = resolveBuildingHeight(properties, { report, featureId: originalId });
    const category = buildingCategory(properties);
    const entrance = Array.isArray(properties.entrance_coords) && properties.entrance_coords.length >= 2
      ? properties.entrance_coords.map(Number)
      : null;
    Object.assign(properties, {
      render_id: renderId,
      render_category: category,
      render_category_label: BUILDING_CATEGORIES[category].label,
      render_base_m: base,
      render_top_m: base + (top - base) * heightScale,
      render_height_m: top - base,
      render_height_source: source,
      render_color: color,
      render_side_color: shade(color, 0.86),
      render_label: properties.name_en_short || properties.name_en || `Building ${originalId}`,
      // Reference interactions/camera read entrance_lon/entrance_lat.
      entrance_lon: entrance && Number.isFinite(entrance[0]) ? entrance[0] : null,
      entrance_lat: entrance && Number.isFinite(entrance[1]) ? entrance[1] : null
    });
    return { type: "Feature", id: renderId, properties, geometry: feature.geometry };
  });
  report.flush();
  return { type: "FeatureCollection", features, _skippedFeatures: filtered._skippedFeatures };
}

// Label points: one per building, at the footprint's pole of inaccessibility
// (always inside the footprint, also for L/U shapes). badgeFor(properties)
// returns the icon id of the building's circular photo badge.
export function buildingLabelPoints(buildings, badgeFor = () => "bcsir-badge:none") {
  return {
    type: "FeatureCollection",
    features: buildings.features.flatMap((feature) => {
      const point = labelAnchor(feature);
      if (!point) return [];
      const p = feature.properties;
      return [{
        type: "Feature",
        id: p.render_id,
        properties: {
          render_id: p.render_id,
          render_label: p.render_label,
          render_top_m: p.render_top_m,
          render_badge: badgeFor(p),
          labeling_priority: Number(p.labeling_priority) || 0
        },
        geometry: { type: "Point", coordinates: point }
      }];
    })
  };
}

// Generic render copy: original properties + validated render_* values.
function normalizeVisual(key, raw) {
  const filtered = filterGeometry(key, raw);
  const report = createReport(DATASET_LABELS[key]);
  const features = filtered.features.map((feature, index) => {
    const visual = resolveVisual(feature.properties || {}, LAYER_DEFAULTS[key], { report, featureId: featureLabel(feature, index) });
    return {
      type: "Feature",
      properties: {
        ...(feature.properties || {}),
        render_id: `${key}_${index}`,
        render_base_m: visual.baseM,
        render_top_m: visual.topM,
        render_thickness_m: visual.thicknessM,
        render_color: visual.color,
        render_fill_color: visual.fillColor,
        render_spacing_m: visual.spacingM
      },
      geometry: feature.geometry
    };
  });
  report.flush();
  return { type: "FeatureCollection", features, _skippedFeatures: filtered._skippedFeatures };
}

export function prepareDataset(key, raw, options = {}) {
  if (key === "buildings") return normalizeBuildings(raw, options.heightScale ?? 1);
  if (GEOMETRY_RULES[key]) return normalizeVisual(key, raw);
  return raw; // network (routing input, untouched) and model point files
}

export async function loadAllData(previous = null, options = {}) {
  const keys = Object.keys(DATA_PATHS);
  const results = await Promise.allSettled(keys.map((key) => fetchDataset(key, options)));
  const output = { raw: {}, render: {}, signatures: {}, errors: [] };
  results.forEach((result, index) => {
    const key = keys[index];
    if (result.status === "fulfilled") {
      output.raw[key] = result.value.data;
      output.signatures[key] = result.value.signature;
      output.render[key] = prepareDataset(key, result.value.data, options);
    } else {
      const message = result.reason?.message || String(result.reason);
      console.warn(`Could not load ${DATASET_LABELS[key]}:`, message);
      output.errors.push(message);
      output.raw[key] = previous?.raw?.[key] || { type: "FeatureCollection", features: [] };
      output.render[key] = previous?.render?.[key] || { type: "FeatureCollection", features: [] };
      output.signatures[key] = previous?.signatures?.[key] || "missing";
    }
  });
  return output;
}

export { parseColor };
