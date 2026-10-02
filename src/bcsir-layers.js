// MapLibre sources and layers for an organisation's site datasets.
//
// Follows the reference addIndoorLayers() pattern: GeoJSON sources with
// promoteId, body + roof fill-extrusion layers, thin roof seams and corner
// columns for crisp 3D edges, labels anchored at roof height, and route layers
// kept above the 3D content.
//
// All feature heights, thicknesses and colours are read from the GeoJSON
// properties (render_* values prepared in bcsir-data.js):
//   base_m      -> fill-extrusion-base
//   top_m       -> fill-extrusion-height
//   color       -> fill-extrusion-color
//   thickness_m -> width in metres of the strip generated around a road or
//                  boundary line (physical width, not a pixel line width)
// The source geometry (road centrelines, boundary lines) is never modified; the
// strips are derived render geometry only.
import { STYLE } from "./config.js";
import { buildingLabelPoints } from "./bcsir-data.js";
import { cutLineGaps, lineStrips, roofSeams, verticalCorners } from "./geo-utils.js";
import { treeLayer } from "./tree-layer.js";
import { surfaceLayer } from "./surface-layer.js";
import { collectModelPlacements } from "./model-placements.js";
import { SOURCE_LAYERS, vectorSource } from "./vector-tiles.js";

export { lineStrips };

// Whether the current map session uses vector tiles (set during addBcsirLayers).
let usingTiles = false;
// The source + sourceLayer reference for building feature-state (interactions.js).
let buildingStateRef = null;
export const getBuildingStateRef = () => buildingStateRef;

// GLB trees placed by TreeLineModels.geojson replace the procedural trees.
const hasTreeModels = (collection) => collectModelPlacements([{ label: "tree models", collection }]).collection.features.length > 0;

const EMPTY = { type: "FeatureCollection", features: [] };
const base = ["get", "render_base_m"];
const top = ["get", "render_top_m"];
const color = ["get", "render_color"];
const roofBase = ["max", base, ["-", top, 0.25]];
const state = (name) => ["boolean", ["feature-state", name], false];

// Layer groups used by the layer manager. `layers` are MapLibre layer ids;
// `custom` names are toggled through their own APIs; `models` lists the datasets
// whose Point/MultiPoint features (or model_points) place GLB models. `dataset` is
// the dataset a group draws: the layer list names its file and leaves out the
// groups whose dataset the organisation does not have.
// See-through copies of the building layers. route-occlusion.js moves the
// buildings that hide the drawn route into them (by filter); they hold no
// building otherwise.
export const ROUTE_FADED_LAYERS = { body: "buildings-body-route-faded", roof: "buildings-roof-route-faded" };
// Invisible extrusion (opacity 0: never drawn, still hit-tested) of the buildings
// drawn by a GLB model instead (building-models.js), so clicking the model selects the
// building as before. Empty until a model has loaded.
export const MODEL_HIT_LAYER = "buildings-model-hit";

export const LAYER_GROUPS = [
  { id: "buildings", label: "Buildings (3D)", dataset: "buildings", layers: ["buildings-footprint", "buildings-body", "buildings-roof", "buildings-roof-seams", "buildings-corners", ROUTE_FADED_LAYERS.body, ROUTE_FADED_LAYERS.roof, MODEL_HIT_LAYER], models: ["buildings"] },
  { id: "labels", label: "Building labels", dataset: "buildings", layers: ["building-labels-major", "building-labels-minor"] },
  { id: "roads", label: "Connected roads", dataset: "roads", layers: ["roads-3d"], models: ["roads"] },
  { id: "roadsDrawing", label: "Connected roads (drawing version)", dataset: "roadsDrawing", layers: ["roads-drawing-3d"], models: ["roadsDrawing"] },
  { id: "pathways", label: "Pathways", dataset: "pathways", layers: ["pathways-3d"], models: ["pathways"] },
  { id: "area", label: "Site area", dataset: "area", layers: ["area-fill"] },
  { id: "boundary", label: "Site boundary", dataset: "boundary", layers: ["boundary-fill", "boundary-wall"], models: ["boundary"] },
  { id: "internal", label: "Internal boundaries", dataset: "internal", layers: ["internal-wall"], models: ["internal"] },
  { id: "garden", label: "Garden", dataset: "garden", layers: ["garden-3d"], custom: "garden", models: ["garden", "gardenModels"] },
  { id: "trees", label: "Tree line", dataset: "treeLine", layers: [], custom: "trees", models: ["treeLine", "treeLineModels"] },
  { id: "route", label: "Calculated route", source: "Walking network and floor plans", layers: ["route-casing", "route-line", "route-access"], custom: "routeMarkers" },
  { id: "models", label: "3D models", dataset: "models", layers: [], custom: "models", models: ["models"] },
  { id: "basemap", label: "Basemap", source: "Street (© OpenStreetMap) or satellite (Esri)", layers: [], custom: "basemap" }
];

// Drawn campus geometry and GLB models. The satellite basemap shows the imagery
// alone, so these groups are hidden while it is active; building labels, the
// route and its pins stay.
export const SATELLITE_HIDDEN_GROUPS = ["buildings", "roads", "roadsDrawing", "pathways", "area", "boundary", "internal", "garden", "trees", "models"];

const extrusion = (id, source, extra = {}) => ({
  id,
  type: "fill-extrusion",
  source,
  ...extra,
  paint: {
    "fill-extrusion-color": color,
    "fill-extrusion-base": base,
    "fill-extrusion-height": top,
    "fill-extrusion-opacity": 1,
    "fill-extrusion-vertical-gradient": false,
    ...(extra.paint || {})
  }
});

// Campus ground: the site area and boundary polygons and the strips built around
// roads, pathways and walls share ONE source; each layer draws its own part (render_part).
// MapLibre updates every source on every camera frame, so one source instead of
// six keeps camera moves light; the layers, their order and paint are unchanged.
const CAMPUS_SOURCE = "campus-ground";
const GROUND_KEYS = ["area", "boundary", "internal", "roads", "roadsDrawing", "pathways"];
const ground = Object.fromEntries(GROUND_KEYS.map((key) => [key, EMPTY]));
// Openings in the drawn boundary wall where a gate is drawn from a GLB model
// (building-models.js, wall_gap_m): [{ point: [lon, lat], halfWidth }]. Render
// geometry only: the data and the walk collision keep the whole wall.
let wallGaps = [];
const tagged = (name, collection) => collection.features.map((feature) => ({ ...feature, properties: { ...feature.properties, render_part: name } }));
// The ground colour fills boundary polygons only: a boundary drawn as a line is a
// wall, and a fill layer would close the line into an area.
const polygonsOnly = (collection) => ({ ...collection, features: collection.features.filter((feature) => feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon") });
function campusGround() {
  return {
    type: "FeatureCollection",
    features: [
      ...tagged("area", ground.area),
      ...tagged("boundary", polygonsOnly(ground.boundary)),
      ...tagged("boundary-wall", lineStrips(cutLineGaps(ground.boundary, wallGaps))),
      ...tagged("internal-wall", lineStrips(ground.internal)),
      ...tagged("roads-drawing", lineStrips(ground.roadsDrawing)),
      ...tagged("pathway", lineStrips(ground.pathways)),
      ...tagged("road", lineStrips(ground.roads))
    ]
  };
}
const partOf = (name) => ["==", ["get", "render_part"], name];
export function setWallGaps(map, gaps) {
  if (usingTiles) return;
  const next = gaps || [];
  if (JSON.stringify(next) === JSON.stringify(wallGaps)) return;
  wallGaps = next;
  map.getSource(CAMPUS_SOURCE)?.setData(campusGround());
}

// badgeFor(properties) gives the icon id of a building label (building-labels.js).
export function addBcsirLayers(map, render, { badgeFor, useTiles = false } = {}) {
  usingTiles = useTiles;
  const buildings = render.buildings;

  // Source names: with vector tiles all layers read from one "tiles" source and
  // select their data through source-layer. With GeoJSON each dataset is its own source.
  const VT = "tiles";
  const src = {
    ground: useTiles ? VT : CAMPUS_SOURCE,
    garden: useTiles ? VT : "garden",
    buildings: useTiles ? VT : "buildings",
    seams: useTiles ? VT : "building-seams",
    corners: useTiles ? VT : "building-corners",
    labels: useTiles ? VT : "building-labels"
  };
  buildingStateRef = useTiles
    ? { source: VT, sourceLayer: SOURCE_LAYERS.buildings }
    : { source: "buildings" };

  if (useTiles) {
    map.addSource(VT, {
      ...vectorSource(),
      promoteId: {
        [SOURCE_LAYERS.buildings]: "render_id",
        [SOURCE_LAYERS.buildingLabels]: "render_id"
      }
    });
  } else {
    GROUND_KEYS.forEach((key) => { ground[key] = render[key] || EMPTY; });
    map.addSource(CAMPUS_SOURCE, { type: "geojson", data: campusGround() });
    map.addSource("garden", { type: "geojson", data: render.garden });
    map.addSource("buildings", { type: "geojson", data: buildings, promoteId: "render_id" });
    map.addSource("building-seams", { type: "geojson", data: roofSeams(buildings) });
    map.addSource("building-corners", { type: "geojson", data: verticalCorners(buildings) });
    map.addSource("building-labels", { type: "geojson", data: buildingLabelPoints(buildings, badgeFor), promoteId: "render_id" });
  }
  map.addSource("route", { type: "geojson", data: EMPTY });

  // source-layer spread: adds "source-layer" for vector tiles, empty for GeoJSON.
  const sl = (sourceLayer) => useTiles ? { "source-layer": sourceLayer } : {};
  const slGround = sl(SOURCE_LAYERS.campusGround);
  const slBuildings = sl(SOURCE_LAYERS.buildings);
  const slSeams = sl(SOURCE_LAYERS.buildingSeams);
  const slCorners = sl(SOURCE_LAYERS.buildingCorners);
  const slGarden = sl(SOURCE_LAYERS.garden);
  const slLabels = sl(SOURCE_LAYERS.buildingLabels);

  // ---- Ground ---------------------------------------------------------------------
  map.addLayer({ id: "area-fill", type: "fill", source: src.ground, ...slGround, filter: partOf("area"), paint: { "fill-color": ["get", "render_fill_color"], "fill-opacity": 0.62 } });
  map.addLayer({ id: "boundary-fill", type: "fill", source: src.ground, ...slGround, filter: partOf("boundary"), paint: { "fill-color": ["get", "render_fill_color"], "fill-opacity": 0.62 } });
  map.addLayer({
    id: "buildings-footprint", type: "fill", source: src.buildings, ...slBuildings,
    paint: { "fill-color": ["get", "render_side_color"], "fill-opacity": 0.35 }
  });

  // ---- 3D ground surfaces, roads and boundaries ------------------------------------
  map.addLayer(extrusion("garden-3d", src.garden, slGarden));
  // Garden polygons with a "surface_model" are covered with that model's top view
  // (grass.glb); they leave garden-3d once the grass is drawn (surface-layer.js).
  const garden = surfaceLayer("garden-surface", render.garden, { coveredLayerId: "garden-3d" });
  map.addLayer(garden);
  map.addLayer(extrusion("roads-drawing-3d", src.ground, { ...slGround, filter: partOf("roads-drawing") }));
  map.addLayer(extrusion("pathways-3d", src.ground, { ...slGround, filter: partOf("pathway") }));
  map.addLayer(extrusion("roads-3d", src.ground, { ...slGround, filter: partOf("road") }));
  map.addLayer(extrusion("boundary-wall", src.ground, { ...slGround, filter: partOf("boundary-wall"), paint: { "fill-extrusion-vertical-gradient": true } }));
  map.addLayer(extrusion("internal-wall", src.ground, { ...slGround, filter: partOf("internal-wall"), paint: { "fill-extrusion-vertical-gradient": true } }));

  // ---- Buildings ----------------------------------------------------------------------
  // Route endpoints take precedence so A/B stay visible while selected.
  const highlight = (fallback) => ["case",
    state("routeSource"), STYLE.routeSource,
    state("routeDestination"), STYLE.routeDestination,
    state("selected"), STYLE.selected,
    state("hover"), STYLE.hover,
    fallback];
  map.addLayer({
    id: "buildings-body", type: "fill-extrusion", source: src.buildings, ...slBuildings,
    paint: {
      "fill-extrusion-color": highlight(["get", "render_side_color"]),
      "fill-extrusion-base": base,
      "fill-extrusion-height": roofBase,
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": false
    }
  });
  map.addLayer({
    id: "buildings-roof", type: "fill-extrusion", source: src.buildings, ...slBuildings,
    paint: {
      "fill-extrusion-color": highlight(color),
      "fill-extrusion-base": roofBase,
      "fill-extrusion-height": top,
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": false
    }
  });
  map.addLayer({
    id: "buildings-roof-seams", type: "fill-extrusion", source: src.seams, ...slSeams, minzoom: 15.5,
    paint: { "fill-extrusion-color": color, "fill-extrusion-base": base, "fill-extrusion-height": top, "fill-extrusion-opacity": 0.6, "fill-extrusion-vertical-gradient": false }
  });
  map.addLayer({
    id: "buildings-corners", type: "fill-extrusion", source: src.corners, ...slCorners, minzoom: 16.5,
    paint: { "fill-extrusion-color": color, "fill-extrusion-base": base, "fill-extrusion-height": top, "fill-extrusion-opacity": 0.6, "fill-extrusion-vertical-gradient": false }
  });
  // Same as buildings-body / buildings-roof, see-through, empty until a building
  // hides the route. Drawn after the opaque buildings so those show through.
  const noBuilding = ["in", ["get", "render_id"], ["literal", []]];
  map.addLayer({
    id: ROUTE_FADED_LAYERS.body, type: "fill-extrusion", source: src.buildings, ...slBuildings, filter: noBuilding,
    paint: { "fill-extrusion-color": highlight(["get", "render_side_color"]), "fill-extrusion-base": base, "fill-extrusion-height": roofBase, "fill-extrusion-opacity": STYLE.routeObscuringOpacity, "fill-extrusion-vertical-gradient": false }
  });
  map.addLayer({
    id: ROUTE_FADED_LAYERS.roof, type: "fill-extrusion", source: src.buildings, ...slBuildings, filter: noBuilding,
    paint: { "fill-extrusion-color": highlight(color), "fill-extrusion-base": roofBase, "fill-extrusion-height": top, "fill-extrusion-opacity": STYLE.routeObscuringOpacity, "fill-extrusion-vertical-gradient": false }
  });
  map.addLayer({
    id: MODEL_HIT_LAYER, type: "fill-extrusion", source: src.buildings, ...slBuildings, filter: noBuilding,
    paint: { "fill-extrusion-color": "#000000", "fill-extrusion-base": base, "fill-extrusion-height": top, "fill-extrusion-opacity": 0 }
  });

  const trees = treeLayer("trees-3d", render.treeLine, { trunkColor: STYLE.treeTrunk });
  trees.setReplaced(hasTreeModels(render.treeLineModels));
  map.addLayer(trees);

  // ---- Overlays: route (always drawn above the 3D content) and labels -------------
  // The route is a red line on a white casing. Source and destination are shown
  // with blue and red location pins (route-markers.js, HTML markers above the map).
  map.addLayer({
    id: "route-casing", type: "line", source: "route", filter: ["==", ["get", "kind"], "network"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": STYLE.routeCasing, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 5, 18, 10, 21, 16], "line-opacity": 0.95 }
  });
  map.addLayer({
    id: "route-line", type: "line", source: "route", filter: ["==", ["get", "kind"], "network"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": STYLE.route, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 3, 18, 6, 21, 10] }
  });
  map.addLayer({
    id: "route-access", type: "line", source: "route", filter: ["==", ["get", "kind"], "access"],
    layout: { "line-cap": "round" },
    paint: { "line-color": STYLE.routeAccess, "line-width": 2.5, "line-dasharray": [1, 1.6], "line-opacity": 0.9 }
  });

  // Building labels: circular photo badge + name, one symbol per building, at
  // roof height. Icon and text are placed together (neither is optional), and
  // MapLibre hides a label rather than let it overlap another. Higher
  // labeling_priority is placed first. Important buildings (priority >= 8)
  // show from zoom 15, all other buildings from zoom 17.
  const labelLayout = {
    "icon-image": ["get", "render_badge"],
    "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 0.78, 18, 1],
    "icon-anchor": "center",
    "icon-padding": 2,
    "icon-optional": false,
    "text-field": ["get", "render_label"],
    "text-font": ["Open Sans Semibold"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 15, 11.5, 18, 12.5, 21, 13],
    "text-anchor": "top",
    "text-offset": [0, 1.4],
    "text-max-width": 9,
    "text-line-height": 1.15,
    "text-padding": 2,
    "text-optional": false,
    "symbol-height-anchor": "ground",
    "symbol-height-offset": ["+", ["coalesce", ["get", "render_top_m"], 0], 1],
    "symbol-sort-key": ["-", 0, ["get", "labeling_priority"]]
  };
  const labelPaint = { "text-color": "#1f2328", "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.6, "text-halo-blur": 0.2 };
  map.addLayer({ id: "building-labels-major", type: "symbol", source: src.labels, ...slLabels, minzoom: 15, filter: [">=", ["get", "labeling_priority"], 8], layout: labelLayout, paint: labelPaint });
  map.addLayer({ id: "building-labels-minor", type: "symbol", source: src.labels, ...slLabels, minzoom: 17, filter: ["<", ["get", "labeling_priority"], 8], layout: labelLayout, paint: labelPaint });

  return { trees, garden };
}

// Replace one dataset's render data (live reload during development).
// Vector tile sources are pre-baked; only GeoJSON sources support setData.
export function updateDatasetLayers(map, key, render, extras = {}) {
  if (usingTiles) { map.triggerRepaint(); return; }
  const data = render[key];
  const set = (id, value) => map.getSource(id)?.setData(value);
  switch (key) {
    case "buildings":
      set("buildings", data);
      set("building-seams", roofSeams(data));
      set("building-corners", verticalCorners(data));
      set("building-labels", buildingLabelPoints(data, extras.badgeFor));
      break;
    case "area":
    case "boundary":
    case "internal":
    case "roads":
    case "roadsDrawing":
    case "pathways":
      ground[key] = data || EMPTY;
      set(CAMPUS_SOURCE, campusGround());
      break;
    case "garden": set("garden", data); extras.garden?.setData(data); break;
    case "treeLine": extras.trees?.setData(data); break;
    case "treeLineModels": extras.trees?.setReplaced(hasTreeModels(data)); break;
    default: break;
  }
  map.triggerRepaint();
}

export function setBuildingOpacity(map, opacity) {
  ["buildings-body", "buildings-roof"].forEach((id) => map.getLayer(id) && map.setPaintProperty(id, "fill-extrusion-opacity", opacity));
  ["buildings-roof-seams", "buildings-corners"].forEach((id) => map.getLayer(id) && map.setPaintProperty(id, "fill-extrusion-opacity", Math.min(0.6, opacity * 0.6)));
}

// Buildings (render_ids) drawn by a GLB model: they get the invisible hit extrusion.
// A building whose floor plan is open has no shell, so no hit extrusion and no label.
let modelHitIds = [];
let shellHiddenIds = [];
const LABEL_FILTERS = { "building-labels-major": [">=", ["get", "labeling_priority"], 8], "building-labels-minor": ["<", ["get", "labeling_priority"], 8] };
function applyShellFilters(map) {
  if (map.getLayer(MODEL_HIT_LAYER)) map.setFilter(MODEL_HIT_LAYER, ["in", ["get", "render_id"], ["literal", modelHitIds.filter((id) => !shellHiddenIds.includes(id))]]);
  for (const [id, filter] of Object.entries(LABEL_FILTERS)) {
    if (map.getLayer(id)) map.setFilter(id, shellHiddenIds.length ? ["all", filter, ["!", ["in", ["get", "render_id"], ["literal", shellHiddenIds]]]] : filter);
  }
}
export function setModelHitBuildings(map, ids) {
  modelHitIds = (ids || []).map(String);
  applyShellFilters(map);
}
// ids: render_ids of the buildings whose floor plan is open ([] = none).
export function setShellHiddenBuildings(map, ids) {
  shellHiddenIds = (ids || []).map(String);
  applyShellFilters(map);
}

// Route line and access legs. Endpoint pins are HTML markers (route-markers.js).
export function setRouteData(map, routeGeoJSON) {
  map.getSource("route")?.setData(routeGeoJSON || EMPTY);
}

// Refresh the label points after building photos loaded (badge icons changed).
export function refreshBuildingLabels(map, buildings, badgeFor) {
  if (usingTiles) return;
  map.getSource("building-labels")?.setData(buildingLabelPoints(buildings, badgeFor));
}
