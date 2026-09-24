// BCSIR 3D map configuration.
//
// Heights, thicknesses and colours of map features come from the GeoJSON files
// in public/data/ (properties base_m, top_m, thickness_m, color, ...). The values
// below are only FALLBACKS, used when a feature has no valid value of its own.

// Dataset URLs (relative to the site root, served from public/data/).
export const DATA_PATHS = {
  boundary: "data/BCSIRBoundary.geojson",
  buildings: "data/BuildingBoundary.geojson",
  roads: "data/ConnectedRoad.geojson",
  roadsDrawing: "data/ConnectedRoadsDrawingVersion.geojson",
  pathways: "data/Pathway.geojson",
  internal: "data/InternalBoundary.geojson",
  garden: "data/Garden.geojson",
  treeLine: "data/TreeLine.geojson",
  models: "data/models.geojson",
  gardenModels: "data/GardenModels.geojson",
  treeLineModels: "data/TreeLineModels.geojson",
  network: "data/ConnectedRoads/v0/r2.json" // routing network (byte-identical copy of the original)
};

// Published data path -> dataset key. Used for live reload during `npm run dev`.
export const DATASET_BY_FILE = Object.fromEntries(Object.entries(DATA_PATHS).map(([key, file]) => [file, key]));

// Initial camera. The map is re-framed to the BCSIR boundary once data loads.
export const INITIAL_VIEW = { center: [90.38612, 23.74024], zoom: 16.6, pitch: 58, bearing: -20 };

// Visibility of GLB models by zoom level and distance (models3d.js). Within these
// limits each model is drawn with the detail level that suits its height on screen
// (public/models/lod/manifest.json, written by `npm run models:optimize`).
export const MODEL_VISIBILITY = {
  minZoom: 14, // below this zoom no GLB model is drawn (a 7.5 m tree is under 2 px)
  maxDistanceM: 3000, // models farther than this from the camera are not drawn
  minPixels: 1.5, // models smaller than this on screen are not drawn
  impostorPixels: 32 // models smaller than this are drawn as pre-rendered views (impostors)
};

// Fallbacks for missing or invalid feature properties, per dataset.
export const LAYER_DEFAULTS = {
  boundary: { base_m: 0, top_m: 3, thickness_m: 0.25, color: "#FFFFFF", fill_color: "#FFFFE6" },
  buildings: { base_m: 0, top_m: 3, color: "#FFFFFF" },
  roads: { base_m: 0, top_m: 0.06, thickness_m: 3, color: "#FFFFFF" },
  roadsDrawing: { base_m: 0, top_m: 0.04, thickness_m: 4, color: "#878787" },
  pathways: { base_m: 0, top_m: 0.05, thickness_m: 1.4, color: "#FFFFFF" },
  internal: { base_m: 0, top_m: 3, thickness_m: 0.25, color: "#FFFFFF" },
  garden: { base_m: 0, top_m: 0.03, color: "#CDEBB0" },
  treeLine: { base_m: 0, top_m: 7.5, color: "#3F8F3A", spacing_m: 7 }
};

// Older property names still understood for building heights (case-insensitive),
// used only when base_m / top_m are absent. "levels" is multiplied by METRES_PER_LEVEL.
export const HEIGHT_FIELDS = {
  top: ["top_m", "height_m", "height", "building_height", "max_height"],
  base: ["base_m", "min_height", "base_height"],
  levels: ["levels", "building_levels", "floors", "storeys"]
};
export const METRES_PER_LEVEL = 3.2;

// BuildingBoundary.geojson already had a `color` attribute holding the QGIS
// category codes o / r / b / g. Those codes still work and map to the QGIS
// colours below (also listed in ReadMeColor.md); a hex value such as "#FF0000"
// replaces them.
export const BUILDING_CATEGORIES = {
  o: { label: "Office", color: "#d9d0c9" },
  r: { label: "Residential", color: "#f7f7f7" },
  b: { label: "Gate", color: "#7b3294" },
  g: { label: "Grounds", color: "#c8facc" },
  other: { label: "Other", color: "#008837" }
};

// Colours of interaction states and of the calculated route (not map data).
// The route is red; the start building is tinted blue and the destination red,
// matching the blue and red location pins.
export const STYLE = {
  treeTrunk: "#7a5230",
  route: "#e53935",
  routeCasing: "#ffffff",
  routeAccess: "#e53935",
  selected: "#fbbf24",
  hover: "#fde68a",
  routeSource: "#7fb2f0",
  routeDestination: "#f28b82"
};
