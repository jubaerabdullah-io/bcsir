// BCSIR 3D map: application start-up.
// Structure adapted from the reference indoor-mapping project's src/main.js.
//
// All datasets are loaded from public/data/ and every visual value (heights,
// thicknesses, colours, GLB models, building images) comes from their GeoJSON
// properties. 3D models are configured in GeoJSON only; there is no model editor.
// Laboratories and testing services come from public/data/directory/.
import * as maplibregl from "maplibre-gl";
import "./style.css";
import { createMap, waitForMap } from "./map.js";
import { DATASET_BY_FILE, INITIAL_VIEW } from "./config.js";
import { DATASET_LABELS, fetchDataset, loadAllData, prepareDataset } from "./bcsir-data.js";
import { addBcsirLayers, LAYER_GROUPS, refreshBuildingLabels, SATELLITE_HIDDEN_GROUPS, setRouteData, updateDatasetLayers } from "./bcsir-layers.js";
import { calculateBounds } from "./geo-utils.js";
import { setupInteractions } from "./interactions.js";
import { createUI } from "./ui.js";
import { createModelGroups } from "./model-placements.js";
import { get3DModelStats } from "./models3d.js";
import { createCameraController } from "./camera-controls.js";
import { createWalkMode } from "./walkMode.js";
import { createLayerManager } from "./layer-manager.js";
import { createRouteService, routeToGeoJSON } from "./routing/route-service.js";
import { createBuildingLabels } from "./building-labels.js";
import { createDirectory } from "./directory.js";
import { DIRECTORY_FILES, loadDirectory } from "./directory-data.js";
import { createSearch } from "./search-ui.js";
import { createDirections } from "./directions-ui.js";
import { createRouteMarkers } from "./route-markers.js";
import { createRouteWalker, routePathCoordinates } from "./route-walker.js";
import { createBasemapControl, savedBasemap } from "./basemap-control.js";
import { describeRoute } from "./route-summary.js";

const map = createMap("map", { basemap: savedBasemap() });
let data;
let routeService;
let ui;
let interactionController;
let cameraController;
let walkController;
let modelGroups;
let layerHandles;
let layerManager;
let labels;
let routeMarkers;
let routeWalker;
let directoryData = { laboratories: [], services: [], sources: [], errors: [] };
let directory;
let search;
let directions;
let homeView;
const heightScale = 1; // GeoJSON heights are drawn exactly (the height-scale slider was removed)
let lastRoute = null;
let buildingsById = new Map();

function indexBuildings() {
  buildingsById = new Map(data.render.buildings.features.map((feature) => [String(feature.properties.render_id), feature]));
}

function rebuildDirectory() {
  directory = createDirectory({ buildings: data.render.buildings, ...directoryData });
}

function campusExtent() {
  return data.render.boundary.features.length ? data.render.boundary : data.render.buildings;
}

function frameCampus(animated = true) {
  const extent = campusExtent();
  if (!extent.features.length) return;
  const bounds = calculateBounds(extent, maplibregl.LngLatBounds);
  if (bounds.isEmpty()) return;
  map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 40 : 90, bearing: -20, pitch: 58, duration: animated ? 1300 : 0, maxZoom: 18.5, essential: true });
  const rememberView = () => { homeView = { center: map.getCenter(), zoom: map.getZoom(), pitch: 58, bearing: -20 }; };
  if (animated) map.once("moveend", rememberView); else rememberView();
}

function resetView() {
  interactionController?.clearSelection();
  if (homeView) map.flyTo({ ...homeView, duration: 900, essential: true }); else frameCampus();
}

// "View on Map" (map button in the right-hand controls): close search lists and
// panels, deselect the building and fit the camera to the BCSIR boundary in the
// default 3D view. The route and its endpoints are kept.
function viewCampus() {
  map.getCanvas().focus({ preventScroll: true });
  search?.close();
  directions?.closeLists();
  layerManager?.setOpen(false);
  cameraController?.markDefaultView();
  interactionController?.setPickHandler(null);
  interactionController?.clearSelection();
  frameCampus(true);
}

// Building feature for a search / directions entry. Buildings are matched by
// their render id; laboratories and tests by the building recorded for them.
function featureForEntry(entry) {
  if (!entry) return null;
  if (entry.kind === "building") return buildingsById.get(String(entry.renderId)) || directory.building(entry.buildingId);
  return directory.building(entry.buildingId);
}

function selectEntry(entry) {
  const feature = featureForEntry(entry);
  if (!feature) {
    ui.showToast(`The building of “${entry.title}” is not recorded in the map data`);
    return;
  }
  ui.setPendingContext(entry.kind === "building" ? null : entry);
  interactionController.selectFeature(feature);
}

function pinFor(feature, endpoint) {
  const resolved = endpoint || (feature ? routeService.endpointFor(feature) : null);
  return resolved ? { point: resolved.point, name: String(feature?.properties?.name_en || "").trim() } : null;
}

// Route calculation uses the original BCSIR algorithm (see routing/route-service.js).
function updateRoute(selection) {
  ui.updateRouteSelection(selection);
  directions.sync(selection);
  cameraController?.updateRoute(selection);
  if (!selection.source || !selection.destination) {
    lastRoute = null;
    setRouteData(map, null);
    routeMarkers.set({ source: pinFor(selection.source), destination: pinFor(selection.destination) });
    routeWalker.set(null);
    directions.showRoute(null);
    return;
  }
  lastRoute = routeService.route(selection.source, selection.destination);
  routeMarkers.set({ source: pinFor(selection.source, lastRoute.source), destination: pinFor(selection.destination, lastRoute.destination) });
  const walking = directions.isWalkOn();
  setRouteData(map, walking ? routeToGeoJSON(lastRoute) : null);
  // A walking figure moves from the start to the destination along the route.
  routeWalker.set(walking ? routePathCoordinates(lastRoute) : null);
  directions.showRoute(describeRoute(lastRoute));
  if (!walking) return;
  if (lastRoute.ok) {
    cameraController?.setRouteCoordinates(lastRoute.coordinates, 0);
    const bounds = new maplibregl.LngLatBounds();
    [...lastRoute.coordinates, lastRoute.source.point, lastRoute.destination.point].forEach((coordinate) => bounds.extend(coordinate));
    if (!walkController?.isActive()) map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 60 : 140, maxZoom: 18.6, pitch: map.getPitch(), bearing: map.getBearing(), duration: 900, essential: true });
  } else {
    ui.showToast("No connected walking path in the campus road network");
  }
}

function refreshLabels() {
  refreshBuildingLabels(map, data.render.buildings, labels.badgeFor);
}

// Development only: reload a single dataset when its file changes on disk.
async function reloadDataset(file) {
  if (Object.values(DIRECTORY_FILES).includes(file)) {
    directoryData = await loadDirectory({ fresh: true });
    rebuildDirectory();
    search.refresh();
    ui.showToast("Laboratory and test directory reloaded");
    return;
  }
  const key = DATASET_BY_FILE[file];
  if (!key) return;
  try {
    const { data: raw, signature } = await fetchDataset(key, { fresh: true });
    if (signature === data.signatures[key]) return;
    data.raw[key] = raw;
    data.signatures[key] = signature;
    data.render[key] = prepareDataset(key, raw, { heightScale });
    if (key === "network") {
      routeService = createRouteService(raw);
      if (lastRoute) updateRoute(interactionController.getRouteSelection());
    } else {
      updateDatasetLayers(map, key, data.render, { ...layerHandles, badgeFor: labels.badgeFor });
    }
    if (key === "buildings") {
      indexBuildings();
      rebuildDirectory();
      interactionController?.reapplyStates();
      labels.load(data.render.buildings);
    }
    await modelGroups.refreshDataset(key);
    ui.showToast(`${DATASET_LABELS[key]} reloaded`);
  } catch (error) {
    console.warn(`Live reload of ${file} failed; keeping the previous version.`, error);
  }
}

function selectFromUrl() {
  const id = new URLSearchParams(window.location.search).get("buildingid");
  if (!id) return;
  const feature = data.render.buildings.features.find((item) => String(item.properties.id) === id);
  if (feature) interactionController.selectFeature(feature);
  else ui.showToast(`Building ${id} was not found`);
}

async function start() {
  await waitForMap(map);
  const directoryLoad = loadDirectory();
  data = await loadAllData(null, { heightScale });
  indexBuildings();
  routeService = createRouteService(data.raw.network);
  labels = createBuildingLabels(map, { onChange: () => refreshLabels() });
  layerHandles = addBcsirLayers(map, data.render, { badgeFor: labels.badgeFor });
  labels.load(data.render.buildings);
  routeMarkers = createRouteMarkers(map);
  routeWalker = createRouteWalker(map);
  directoryData = await directoryLoad;
  rebuildDirectory();

  // GLB models placed by GeoJSON features, one set per layer group.
  modelGroups = createModelGroups({
    map,
    groups: Object.fromEntries(LAYER_GROUPS.filter((group) => group.models).map((group) => [group.id, group.models])),
    getDatasets: () => data.raw,
    labels: DATASET_LABELS
  });

  ui = createUI({
    map,
    onClearSelection: () => interactionController?.clearSelection(),
    onSetSource: (feature, context) => {
      if (context) directions.setEndpointEntry("source", context); else interactionController?.setSourceFeature(feature);
      ui.showToast(`${String(feature.properties?.name_en || "Building").trim()} set as the starting point`);
    },
    onSetDestination: (feature, context) => {
      if (context) directions.setEndpointEntry("destination", context); else interactionController?.setDestinationFeature(feature);
      ui.showToast(`${String(feature.properties?.name_en || "Building").trim()} set as the destination`);
    },
    onReset: resetView
  });

  search = createSearch({ getDirectory: () => directory, onSelect: selectEntry, onMessage: ui.showToast });

  directions = createDirections({
    getDirectory: () => directory,
    resolveFeature: featureForEntry,
    onSetEndpoint: (kind, feature) => (kind === "source" ? interactionController.setSourceFeature(feature) : interactionController.setDestinationFeature(feature)),
    onClearEndpoint: (kind) => (kind === "source" ? interactionController.clearSourceFeature() : interactionController.clearDestinationFeature()),
    onSwap: () => interactionController.swapRouteEndpoints(),
    onClearRoute: () => { interactionController.clearRouteSelection(); ui.showToast("Route cleared"); },
    onPick: (kind, handler) => {
      interactionController.setPickHandler(handler || null);
      if (kind) { walkController?.cancelChoosing(); interactionController.clearSelection(); ui.showToast(`Click a building to set the ${kind === "source" ? "starting point" : "destination"}`); }
    },
    onWalkChange: () => updateRoute(interactionController.getRouteSelection()),
    onMessage: ui.showToast
  });

  cameraController = createCameraController(map, { onReset: resetView, onMessage: ui.showToast });
  window.bcsirCamera = Object.freeze({
    setRouteCoordinates: (coordinates, currentSegmentIndex = 0) => cameraController?.setRouteCoordinates(coordinates, currentSegmentIndex),
    routeUp: () => cameraController?.routeUp(),
    followDirection: () => cameraController?.followDirection()
  });

  interactionController = setupInteractions(map, {
    resolveFeature: (id) => buildingsById.get(String(id)),
    // Off in walk mode and while a first-person location is being chosen.
    isEnabled: () => !walkController?.isActive() && !walkController?.isChoosing(),
    onSelect: ui.showBuilding,
    onClear: ui.hideBuilding,
    onRouteChange: updateRoute
  });

  walkController = createWalkMode({
    map,
    getFloorElevation: () => 0,
    getLevelLabel: () => "Ground",
    beforeOpen: () => { interactionController?.clearSelection(); directions?.closeLists(); return true; },
    onToast: ui.showToast
  });

  // Satellite shows the imagery alone: the drawn campus layers are hidden.
  const hiddenFor = (basemapId) => (basemapId === "satellite" ? SATELLITE_HIDDEN_GROUPS : []);
  const basemap = createBasemapControl(map, {
    container: document.querySelector("#basemap-options"),
    center: INITIAL_VIEW.center,
    onChange: (id) => layerManager?.setSuppressed(hiddenFor(id))
  });

  layerManager = createLayerManager({
    map,
    suppressed: hiddenFor(basemap.get()),
    custom: {
      trees: (visible) => layerHandles.trees?.setVisible(visible),
      garden: (visible) => layerHandles.garden?.setVisible(visible),
      routeMarkers: (visible) => { routeMarkers.setVisible(visible); routeWalker.setVisible(visible); },
      basemap: (visible) => basemap.setEnabled(visible)
    },
    onVisibilityChange: (groupId, visible) => { modelGroups.setVisible(groupId, visible).catch((error) => console.error(`3D models of "${groupId}" could not be loaded:`, error)); },
    datasetCounts: {
      buildings: data.render.buildings.features.length,
      roads: data.render.roads.features.length,
      roadsDrawing: data.render.roadsDrawing.features.length,
      pathways: data.render.pathways.features.length,
      boundary: data.render.boundary.features.length,
      internal: data.render.internal.features.length,
      garden: data.render.garden.features.length,
      trees: data.render.treeLine.features.length,
      models: data.raw.models.features.length
    }
  });

  document.querySelector("#view-on-map").addEventListener("click", viewCampus);

  cameraController.updateTarget(campusExtent());
  frameCampus(false);
  const failed = data.errors.length + directoryData.errors.length;
  if (failed) {
    ui.setStatus(`${failed} data file${failed > 1 ? "s" : ""} could not be loaded`, "error");
    ui.showToast("Some BCSIR data files could not be loaded");
  } else {
    ui.hideStatus();
  }
  updateRoute(interactionController.getRouteSelection());
  selectFromUrl();

  if (import.meta.hot) import.meta.hot.on("bcsir:data-changed", ({ file }) => reloadDataset(file));

  // Read-only diagnostics used by the automated browser tests.
  window.bcsir3d = Object.freeze({
    map,
    routeStats: () => ({ ...routeService.stats }),
    lastRoute: () => lastRoute,
    featureCounts: () => Object.fromEntries(Object.entries(data.render).map(([key, value]) => [key, value.features.length])),
    errors: () => [...data.errors, ...directoryData.errors],
    loadedModelGroups: () => modelGroups.loadedGroups(),
    modelStats: () => get3DModelStats(),
    basemap: () => basemap.get(),
    setBasemap: (id) => basemap.set(id),
    labelPhotos: () => labels.loadedCount(),
    search: (query, options) => directory.search(query, options).results.map(({ kind, key, title, subtitle, meta, buildingId }) => ({ kind, key, title, subtitle, meta, buildingId })),
    selectedBuildingId: () => interactionController.getSelectedId(),
    selectBuilding: (id) => { const feature = data.render.buildings.features.find((item) => String(item.properties.id) === String(id)); if (feature) interactionController.selectFeature(feature, false); return Boolean(feature); },
    routeBetween: (a, b) => {
      const find = (id) => data.render.buildings.features.find((item) => String(item.properties.id) === String(id));
      interactionController.setSourceFeature(find(a));
      interactionController.setDestinationFeature(find(b));
      return lastRoute;
    }
  });
}

start().catch((error) => {
  console.error("BCSIR map initialization failed:", error);
  const status = document.querySelector("#map-status");
  if (status) status.textContent = "BCSIR map could not start";
  document.querySelector("#status-chip")?.removeAttribute("hidden");
  document.querySelector(".status-dot")?.classList.add("error");
});
