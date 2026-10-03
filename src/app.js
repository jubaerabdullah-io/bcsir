// The 3D map of the open organisation (org.js): application start-up.
// Structure adapted from the reference indoor-mapping project's src/main.js.
//
// All datasets are loaded from public/data/<organisation>/ and every visual value (heights,
// thicknesses, colours, GLB models, building images) comes from their GeoJSON
// properties. 3D models are configured in GeoJSON only; there is no model editor.
// Laboratories and testing services come from the organisation's directory files.
import * as maplibregl from "maplibre-gl";
import "./style.css";
import { createMap, waitForMap } from "./map.js";
import { BUILDING_MODELS, DATASET_KEYS, INITIAL_VIEW } from "./config.js";
import { activeOrg, datasetKeyOfPath } from "./org.js";
import { datasetLabel, fetchDataset, loadAllData, prepareDataset } from "./bcsir-data.js";
import { addBcsirLayers, getBuildingStateRef, LAYER_GROUPS, refreshBuildingLabels, SATELLITE_HIDDEN_GROUPS, setModelHitBuildings, setRouteData, setShellHiddenBuildings, setWallGaps, updateDatasetLayers } from "./bcsir-layers.js";
import { hasTiles, registerProtocol } from "./vector-tiles.js";
import { calculateBounds, lineStrips } from "./geo-utils.js";
import { setupInteractions } from "./interactions.js";
import { createUI } from "./ui.js";
import { createModelGroups } from "./model-placements.js";
import { get3DModelStats, setFadedModelBuildings, setHiddenModelBuildings } from "./models3d.js";
import { createCameraController } from "./camera-controls.js";
import { createWalkMode } from "./walkMode.js";
import { createLayerManager } from "./layer-manager.js";
import { createRouteService, routeToGeoJSON } from "./routing/route-service.js";
import { createBuildingLabels } from "./building-labels.js";
import { createDirectory } from "./directory.js";
import { directoryFiles, loadDirectory } from "./directory-data.js";
import { createSearch } from "./search-ui.js";
import { createDirections } from "./directions-ui.js";
import { createRouteMarkers } from "./route-markers.js";
import { createRouteWalker, routePathCoordinates } from "./route-walker.js";
import { createBasemapControl, savedBasemap } from "./basemap-control.js";
import { describeRoute } from "./route-summary.js";
import { createRouteOcclusion } from "./route-occlusion.js";
import { blocksWalking, collisionBlockers, createCollisionWorld } from "./navigation/collision.js";
import { correctRouteResult, prepareObstacles } from "./navigation/route-detour.js";
import { createLiveNavigation } from "./navigation/live-navigation.js";
import { createMinimap } from "./navigation/minimap.js";
import { createBuildingModels } from "./building-models.js";
import { createIndoor } from "./indoor/indoor-controller.js";
import { describeTrip, planIndoorTrip } from "./indoor/trip.js";
import { viewMode } from "./view-mode.js";

const org = activeOrg();
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
// Drawn route: lastRoute with its geometry led around buildings
// (navigation/route-detour.js); the node path is lastRoute's.
let displayRoute = null;
let obstacles = null;
let collisionWorld = null;
let walkIndoorState = {};
let routeOcclusion;
let minimap;
let navigation;
let buildingModels;
// Floor plans (indoor/indoor-controller.js). A route endpoint is a building; when
// it is a room or point inside that building, its id is kept here.
let indoor;
let routePlaces = { source: null, destination: null };
let trip = null; // indoor parts and description of the current route (indoor/trip.js)
let tripToken = 0;

// Buildings and walls for route correction, walk collision and the minimap.
function buildNavigationGeometry() {
  obstacles = prepareObstacles(data.render.buildings, { blocks: blocksWalking });
  collisionWorld = createCollisionWorld({
    frame: obstacles.frame,
    blockers: collisionBlockers({
      buildings: data.render.buildings,
      walls: [
        { collection: lineStrips(data.render.internal), kind: "wall", name: "An internal wall" },
        { collection: lineStrips(data.render.boundary), kind: "wall", name: "The campus boundary wall" }
      ]
    })
    // indoor: no building has indoor map data yet, so every building is solid.
  });
  minimap?.setData({ buildings: data.render.buildings, garden: data.render.garden, roads: data.render.roads, pathways: data.render.pathways });
}

// Draws a route result (or nothing): the route line, the see-through buildings
// in front of it and the minimap route.
function showRouteGeometry(result) {
  const geojson = result ? routeToGeoJSON(result) : null;
  setRouteData(map, geojson);
  routeOcclusion?.setRoute(geojson ? geojson.features.map((feature) => feature.geometry.coordinates) : null);
  minimap?.setRoute(result?.ok ? routePathCoordinates(result) : null, result?.destination?.point || null);
}

const listNames = (items) => items.map((item) => item.name || `building ${item.id}`).join(", ");

// Route summary for the drawn route, with notes on corrected geometry.
function describeDisplayRoute(result) {
  const description = describeRoute(result);
  if (!description) return description;
  const notes = [...description.notes];
  if (result.detours?.length) notes.push(`The route line goes around ${listNames(result.detours)}: no building here has an indoor passage.`);
  if (result.unresolved?.length) notes.push(`The route line crosses ${listNames(result.unresolved)}: the endpoint lies inside that building's footprint, so no outdoor path to it is mapped.`);
  return { ...description, notes, navigable: Boolean(result.ok && result.networkDistanceM > 0) };
}

function indexBuildings() {
  buildingsById = new Map(data.render.buildings.features.map((feature) => [String(feature.properties.render_id), feature]));
}

function rebuildDirectory() {
  directory = createDirectory({ buildings: data.render.buildings, ...directoryData, places: org.places, indoor: org.indoor });
}

// Search / directions entry of a room or point of a floor plan. A room without a
// name is not in the directory: it gets an entry of its own.
function placeEntry(uid) {
  if (!uid) return null;
  const known = directory.entry(`place:${uid}`);
  if (known) return known;
  const [key, levelId] = String(uid).split("/");
  const building = indoor?.store.building(key);
  if (!building) return null;
  return { kind: "place", key: `place:${uid}`, id: uid, title: `Room on ${building.levelById.get(levelId)?.name || levelId}`, subtitle: "", meta: building.name, buildingId: building.buildingId, placeUid: uid };
}

// Sets a route endpoint: a building, or (placeUid) a room or point inside it.
function setEndpoint(kind, feature, placeUid = null) {
  routePlaces[kind] = placeUid;
  if (kind === "source") interactionController.setSourceFeature(feature); else interactionController.setDestinationFeature(feature);
}

function campusExtent() {
  return [data.render.boundary, data.render.area].find((collection) => collection.features.length) || data.render.buildings;
}

// The whole-site view: tilted 3D, or straight above and north up with ?view=2d.
const HOME_CAMERA = viewMode().flat ? { bearing: 0, pitch: 0 } : { bearing: -20, pitch: 58 };

function frameCampus(animated = true) {
  const extent = campusExtent();
  if (!extent.features.length) return;
  const bounds = calculateBounds(extent, maplibregl.LngLatBounds);
  if (bounds.isEmpty()) return;
  map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 40 : 90, ...HOME_CAMERA, duration: animated ? 1300 : 0, maxZoom: 18.5, essential: true });
  const rememberView = () => { homeView = { center: map.getCenter(), zoom: map.getZoom(), ...HOME_CAMERA }; };
  if (animated) map.once("moveend", rememberView); else rememberView();
}

function resetView() {
  interactionController?.clearSelection();
  indoor?.closeAll();
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
  indoor?.closeAll();
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
  // A room or point: its floor is opened and the place itself is selected.
  if (entry.kind === "place") { indoor.selectPlace(entry.placeUid); return; }
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

// Pin of a route endpoint: on the chosen room or point, else on the building's entrance.
function endpointPin(kind, feature, endpoint) {
  const uid = routePlaces[kind];
  const place = uid ? indoor.store.place(uid) : null;
  return place ? { point: place.point, name: place.name, uid } : pinFor(feature, endpoint);
}

// Draws the route pins. A pin on a room is left out while another floor of its
// building is shown: rooms above each other would otherwise share one spot.
let routePins = { source: null, destination: null };
function showRoutePins(pins = routePins) {
  routePins = pins;
  const open = indoor.openLevels();
  const visible = (pin) => {
    if (!pin?.uid) return pin;
    const [key, levelId] = pin.uid.split("/");
    return open[key] === undefined || open[key] === levelId ? pin : null;
  };
  routeMarkers.set({ source: visible(pins.source), destination: visible(pins.destination) });
}

// The part of a route inside buildings (indoor/trip.js): from a room to the
// building's entrance, and from the entrance of the destination building to the
// room there, by the lift or the stairs. `token` drops a result that a newer route
// has overtaken (floors are loaded while it is calculated).
async function planTrip(selection, places, token) {
  const sameBuilding = selection.source === selection.destination;
  const keyOf = (feature) => indoor.store.forBuildingId(feature.properties?.id)?.key || null;
  const outdoorResult = displayRoute;
  let result;
  try {
    result = await planIndoorTrip({
      store: indoor.store,
      sameBuilding,
      stepFree: directions.isStepFree(),
      source: { key: keyOf(selection.source), uid: places.source, door: lastRoute?.source?.point || null },
      destination: { key: keyOf(selection.destination), uid: places.destination, door: lastRoute?.destination?.point || null }
    });
  } catch (error) {
    console.warn("The indoor route could not be calculated.", error);
    result = { start: null, end: null, problems: ["The floor plans could not be loaded, so only the route between the buildings is shown."] };
  }
  if (token !== tripToken) return;
  const walking = directions.isWalkOn();
  const outdoor = sameBuilding ? null : { ok: outdoorResult.ok, networkDistanceM: outdoorResult.networkDistanceM, coordinates: outdoorResult.coordinates, description: describeDisplayRoute(outdoorResult) };
  const parts = [result.start, result.end].filter((part) => part?.ok);
  const samples = [...new Set(parts.map((part) => part.building))].filter((key) => indoor.store.building(key)?.sample);
  const description = describeTrip({
    outdoor,
    ...result,
    problems: [...result.problems, ...samples.map((key) => `The floor plan of ${indoor.buildingName(key)} is a sample, not a survey.`)],
    destinationName: String(selection.destination.properties?.name_en_short || selection.destination.properties?.name_en || "the destination").trim(),
    buildingName: indoor.buildingName,
    levelShort: indoor.levelShort
  });
  trip = { ...result, description };
  directions.showRoute(description);
  indoor.setRouteLegs(walking ? parts.flatMap((part) => part.legs) : []);
  // Pins on the places the indoor route really starts and ends at.
  const last = sameBuilding ? result.start : result.end;
  showRoutePins({
    source: places.source && result.start?.ok ? { point: result.start.from.point, name: result.start.from.label, uid: places.source } : endpointPin("source", selection.source, lastRoute?.source),
    destination: places.destination && last?.ok ? { point: last.to.point, name: last.to.label, uid: places.destination } : endpointPin("destination", selection.destination, lastRoute?.destination)
  });
  if (!walking || !parts.length) return;
  // The floors the route starts and arrives on are opened, and the camera shows the
  // first part of the route: indoors when it starts in a room, else the way there.
  for (const part of parts) await indoor.openLevel(part.building, part.from.level, { fit: false });
  if (token !== tripToken || walkController?.isActive() || navigation?.isActive()) return;
  const bounds = new maplibregl.LngLatBounds();
  const firstLeg = result.start?.ok ? result.start.legs.find((leg) => leg.type === "walk") : null;
  if (firstLeg) firstLeg.coordinates.forEach((coordinate) => bounds.extend(coordinate));
  else {
    if (outdoor?.ok) outdoor.coordinates.forEach((coordinate) => bounds.extend(coordinate));
    result.end.legs.filter((leg) => leg.type === "walk" && leg.level === result.end.from.level).forEach((leg) => leg.coordinates.forEach((coordinate) => bounds.extend(coordinate)));
  }
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: window.innerWidth < 700 ? { top: 170, bottom: 190, left: 40, right: 70 } : { top: 150, bottom: 110, left: 110, right: 160 }, maxZoom: 20, pitch: Math.min(map.getPitch(), 52), bearing: map.getBearing(), duration: 900, essential: true });
}

// Shows one step of an indoor route (directions panel): its floor and its line.
async function showStep(step) {
  if (!step) return;
  if (step.building) await indoor.openLevel(step.building, step.level, { fit: false });
  const coordinates = step.coordinates || (step.point ? [step.point] : []);
  if (!coordinates.length) return;
  const bounds = new maplibregl.LngLatBounds();
  coordinates.forEach((coordinate) => bounds.extend(coordinate));
  map.fitBounds(bounds, { padding: window.innerWidth < 700 ? { top: 170, bottom: 190, left: 40, right: 70 } : { top: 150, bottom: 110, left: 110, right: 160 }, maxZoom: step.building ? 20.5 : 18.6, pitch: Math.min(map.getPitch(), 52), bearing: map.getBearing(), duration: 800, essential: true });
}

// Route calculation between buildings uses the original BCSIR algorithm (see
// routing/route-service.js); the parts inside buildings are added by planTrip().
function updateRoute(selection) {
  // A room belongs to its building: it goes when that endpoint is cleared.
  if (!selection.source) routePlaces.source = null;
  if (!selection.destination) routePlaces.destination = null;
  const places = { ...routePlaces };
  const token = ++tripToken;
  trip = null;
  ui.updateRouteSelection(selection);
  directions.sync({ ...selection, entries: { source: placeEntry(places.source), destination: placeEntry(places.destination) } });
  indoor.setEndpoints(places);
  cameraController?.updateRoute(selection);
  if (!selection.source || !selection.destination) {
    lastRoute = null;
    displayRoute = null;
    showRouteGeometry(null);
    showRoutePins({ source: endpointPin("source", selection.source), destination: endpointPin("destination", selection.destination) });
    routeWalker.set(null);
    directions.showRoute(null);
    navigation?.setRoute(null);
    indoor.setRouteLegs([]);
    return;
  }
  lastRoute = routeService.route(selection.source, selection.destination);
  displayRoute = correctRouteResult(lastRoute, obstacles);
  showRoutePins({ source: endpointPin("source", selection.source, lastRoute.source), destination: endpointPin("destination", selection.destination, lastRoute.destination) });
  const indoorTrip = Boolean(places.source || places.destination);
  // Both ends in one building: there is no walk outside to draw.
  const walking = directions.isWalkOn() && !(indoorTrip && selection.source === selection.destination);
  showRouteGeometry(walking ? displayRoute : null);
  // A walking figure moves from the start to the destination along the route.
  routeWalker.set(walking ? routePathCoordinates(displayRoute) : null);
  navigation?.setRoute(walking ? displayRoute : null);
  if (indoorTrip) {
    if (walking && lastRoute.ok) cameraController?.setRouteCoordinates(displayRoute.coordinates, 0);
    planTrip(selection, places, token);
    return;
  }
  indoor.setRouteLegs([]);
  directions.showRoute(describeDisplayRoute(displayRoute));
  if (!walking) return;
  if (lastRoute.ok) {
    cameraController?.setRouteCoordinates(displayRoute.coordinates, 0);
    const bounds = new maplibregl.LngLatBounds();
    [...displayRoute.coordinates, lastRoute.source.point, lastRoute.destination.point].forEach((coordinate) => bounds.extend(coordinate));
    if (!walkController?.isActive() && !navigation?.isActive()) map.fitBounds(bounds, { padding: window.innerWidth < 700 ? 60 : 140, maxZoom: 18.6, pitch: map.getPitch(), bearing: map.getBearing(), duration: 900, essential: true });
  } else {
    ui.showToast("No connected walking path in the road network");
  }
}

function refreshLabels() {
  refreshBuildingLabels(map, data.render.buildings, labels.badgeFor);
}

// Development only: reload a single dataset when its file changes on disk.
async function reloadDataset(file) {
  if (Object.values(directoryFiles()).includes(file)) {
    directoryData = await loadDirectory({ fresh: true });
    rebuildDirectory();
    search.refresh();
    ui.showToast("Laboratory and test directory reloaded");
    return;
  }
  if (indoor.reloadFile(file)) { ui.showToast("Floor plan reloaded"); return; }
  const key = datasetKeyOfPath(file);
  // A file the organisation's index does not list yet (a new floor or building
  // folder, org.json): the index is read again by reloading the page.
  if (!key) { if (file.startsWith(`data/${org.id}/`)) window.location.reload(); return; }
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
    if (["buildings", "internal", "boundary", "garden", "roads", "pathways"].includes(key)) {
      buildNavigationGeometry();
      if (lastRoute && key === "buildings") updateRoute(interactionController.getRouteSelection());
    }
    if (key === "buildings") buildingModels.update();
    await modelGroups.refreshDataset(key);
    ui.showToast(`${datasetLabel(key)} reloaded`);
  } catch (error) {
    console.warn(`Live reload of ${file} failed; keeping the previous version.`, error);
  }
}

// Deep links: ?buildingid=127 selects a building, ?place=<id> a room of a floor plan.
function selectFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const place = params.get("place");
  if (place) indoor.selectPlace(place).then((found) => { if (!found) ui.showToast("That place was not found"); });
  const id = params.get("buildingid");
  if (!id) return;
  const feature = data.render.buildings.features.find((item) => String(item.properties.id) === id);
  if (feature) interactionController.selectFeature(feature);
  else ui.showToast(`Building ${id} was not found`);
}

async function start() {
  await waitForMap(map);
  const directoryLoad = loadDirectory();
  const [, useTiles] = await Promise.all([loadAllData(null, { heightScale }).then((d) => { data = d; }), hasTiles()]);
  if (useTiles) registerProtocol(maplibregl);
  indexBuildings();
  routeService = createRouteService(data.raw.network);
  labels = createBuildingLabels(map, { onChange: () => refreshLabels() });
  layerHandles = addBcsirLayers(map, data.render, { badgeFor: labels.badgeFor, useTiles });
  labels.load(data.render.buildings);
  routeMarkers = createRouteMarkers(map);
  routeWalker = createRouteWalker(map);
  routeOcclusion = createRouteOcclusion(map, {
    getFeature: (id) => buildingsById.get(String(id)),
    getViewpoint: () => (walkController?.isActive() ? walkController.getPose() : null),
    setFadedModels: (ids) => setFadedModelBuildings(map, ids)
  });
  minimap = createMinimap({ container: document.querySelector("#walk-minimap") });
  buildNavigationGeometry();

  // Buildings with floor plans: the floor selector, rooms and indoor routes.
  indoor = createIndoor({
    map,
    org,
    getBuildingFeature: (id) => (id === null || id === undefined ? null : data.render.buildings.features.find((feature) => String(feature.properties.id) === String(id)) || null),
    setHiddenShells: (ids) => { routeOcclusion.setHiddenBuildings(ids); setShellHiddenBuildings(map, ids); setHiddenModelBuildings(map, ids); },
    isBusy: () => Boolean(walkController?.isActive() || walkController?.isChoosing() || navigation?.isActive()),
    onPlaceShown: () => interactionController?.clearSelection(),
    onRoutePlace: (kind, uid) => {
      const entry = placeEntry(uid);
      if (!entry) return;
      directions.setEndpointEntry(kind, entry);
      ui.showToast(`${entry.title} set as the ${kind === "source" ? "starting point" : "destination"}`);
    },
    onChange: () => { routeOcclusion.refresh(); showRoutePins(); },
    onMessage: (message) => ui?.showToast(message)
  });
  directoryData = await directoryLoad;
  rebuildDirectory();

  // Buildings with a building_model are drawn from that GLB instead of their extrusion.
  buildingModels = createBuildingModels({
    map,
    getBuildings: () => data.render.buildings,
    // Models tiled bay by bay are listed per organisation (org.json "model_modules").
    config: { ...BUILDING_MODELS, modules: org.model_modules || {} },
    onReplacedChange: (ids, wallGaps) => { routeOcclusion.setReplacedBuildings(ids); setModelHitBuildings(map, ids); setWallGaps(map, wallGaps); }
  });

  // GLB models placed by GeoJSON features, one set per layer group.
  modelGroups = createModelGroups({
    map,
    groups: Object.fromEntries(LAYER_GROUPS.filter((group) => group.models).map((group) => [group.id, group.models])),
    getDatasets: () => data.raw,
    labels: Object.fromEntries(DATASET_KEYS.map((key) => [key, datasetLabel(key)])),
    extraPlacements: { buildings: () => buildingModels.placements() }
  });

  ui = createUI({
    map,
    onClearSelection: () => interactionController?.clearSelection(),
    onSetSource: (feature, context) => {
      if (context) directions.setEndpointEntry("source", context); else setEndpoint("source", feature);
      ui.showToast(`${String(feature.properties?.name_en || "Building").trim()} set as the starting point`);
    },
    onSetDestination: (feature, context) => {
      if (context) directions.setEndpointEntry("destination", context); else setEndpoint("destination", feature);
      ui.showToast(`${String(feature.properties?.name_en || "Building").trim()} set as the destination`);
    },
    onReset: resetView
  });

  search = createSearch({ getDirectory: () => directory, onSelect: selectEntry, onMessage: ui.showToast });

  directions = createDirections({
    getDirectory: () => directory,
    resolveFeature: featureForEntry,
    onSetEndpoint: (kind, feature, entry) => setEndpoint(kind, feature, entry?.kind === "place" ? entry.placeUid : null),
    onClearEndpoint: (kind) => { routePlaces[kind] = null; if (kind === "source") interactionController.clearSourceFeature(); else interactionController.clearDestinationFeature(); },
    onSwap: () => { routePlaces = { source: routePlaces.destination, destination: routePlaces.source }; interactionController.swapRouteEndpoints(); },
    onClearRoute: () => { routePlaces = { source: null, destination: null }; interactionController.clearRouteSelection(); ui.showToast("Route cleared"); },
    onStep: showStep,
    onStepFreeChange: () => updateRoute(interactionController.getRouteSelection()),
    onPick: (kind, handler) => {
      interactionController.setPickHandler(handler || null);
      if (kind) { walkController?.cancelChoosing(); interactionController.clearSelection(); indoor.clearSelection(); ui.showToast(`Click a building or a room to set the ${kind === "source" ? "starting point" : "destination"}`); }
    },
    onWalkChange: () => updateRoute(interactionController.getRouteSelection()),
    onNavigate: (view) => navigation?.start({ view }),
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
    buildingSource: getBuildingStateRef(),
    // Off in walk mode, while a first-person location is being chosen and while
    // the navigation position is being set on the map.
    isEnabled: () => !walkController?.isActive() && !walkController?.isChoosing() && !navigation?.isPickingPosition(),
    // An open floor plan takes clicks first: a room or point is selected, or (while
    // a route endpoint is being chosen on the map) handed to the directions panel.
    interceptClick: (event, pick) => {
      if (!pick) return indoor.handleClick(event);
      const uid = indoor.placeAt(event.point);
      const entry = uid ? placeEntry(uid) : null;
      const feature = entry ? directory.building(entry.buildingId) : null;
      if (!feature) return false;
      pick(feature, entry);
      return true;
    },
    interceptMove: (event) => indoor.handleMove(event),
    onSelect: (feature) => { indoor.clearSelection(); ui.showBuilding(feature); indoor.buildingSelected(feature); },
    onClear: () => { ui.hideBuilding(); indoor.buildingSelected(null); },
    onRouteChange: updateRoute
  });

  walkController = createWalkMode({
    map,
    getFloorElevation: () => 0,
    getLevelLabel: () => "Ground",
    // Walk mode is outdoors: open floor plans close, so their buildings are solid again.
    beforeOpen: () => { interactionController?.clearSelection(); indoor.closeAll(); directions?.closeLists(); return true; },
    onToast: ui.showToast,
    // Walls and buildings without an indoor map cannot be walked through.
    resolveMove: (from, to) => collisionWorld.resolveMove(from, to, walkIndoorState),
    // The follow camera stops in front of the first building or wall behind the character.
    cameraClearance: (from, to) => collisionWorld.firstHit(from, to)?.t ?? 1,
    resolveStart: (position) => {
      const blocker = collisionWorld.blockerAt(position);
      if (!blocker) return null;
      return {
        position: collisionWorld.nearestFree(position),
        message: blocker.kind === "building" ? `${blocker.name || "That building"} has no indoor map, so the walk starts outside it.` : "The walk starts beside the wall."
      };
    },
    onPose: (pose) => { minimap?.update(pose.position, pose.heading); navigation?.onWalkPose(pose); },
    onStateChange: (state) => {
      if (state === "entering") walkIndoorState = {};
      minimap?.show(state === "active");
      routeWalker.setSuppressed(state !== "idle" || Boolean(navigation?.isActive()));
      navigation?.onWalkState(state);
    },
    onManualInput: () => navigation?.onManualInput(),
    steer: (context) => navigation?.steer(context) || 0
  });

  const campusBounds = calculateBounds(campusExtent(), maplibregl.LngLatBounds);
  navigation = createLiveNavigation({
    map,
    walk: walkController,
    collision: { nearestFree: (point) => collisionWorld.nearestFree(point), hasIndoor: (id) => collisionWorld.hasIndoor(id) },
    campusCenter: campusBounds.isEmpty() ? null : campusBounds.getCenter().toArray(),
    cameraController,
    getRoute: () => (directions.isWalkOn() ? displayRoute : null),
    // Off the route for a while: a new route from the position to the same
    // destination, with the original routing algorithm.
    reroute: (position) => {
      const destination = interactionController.getRouteSelection().destination;
      if (!destination) return null;
      const result = correctRouteResult(routeService.routeFromPoint(position, destination), obstacles);
      if (result.ok) showRouteGeometry(result);
      return result;
    },
    onSession: (active) => {
      routeWalker.setSuppressed(active || walkController.isActive());
      if (active) {
        interactionController.clearSelection();
        interactionController.setPickHandler(null);
        search.close();
        directions.closeLists();
        layerManager?.setOpen(false);
      } else {
        showRouteGeometry(directions.isWalkOn() ? displayRoute : null); // a re-routed line goes back to the chosen route
      }
    },
    onToast: ui.showToast
  });

  // Satellite shows the imagery alone: the drawn campus layers are hidden.
  const hiddenFor = (basemapId) => (basemapId === "satellite" ? SATELLITE_HIDDEN_GROUPS : []);
  const basemap = createBasemapControl(map, {
    container: document.querySelector("#basemap-options"),
    center: org.view?.center || INITIAL_VIEW.center,
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
      area: data.render.area.features.length,
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
    ui.showToast("Some map data files could not be loaded");
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
      setEndpoint("source", find(a));
      setEndpoint("destination", find(b));
      return lastRoute;
    },
    // Floor plans: open floors, rooms, and routes between rooms.
    indoor: Object.freeze({
      buildings: () => indoor.store.buildings.map(({ key, name, buildingId, levels }) => ({ key, name, buildingId, levels: levels.map((level) => level.id) })),
      places: () => org.places,
      open: (key, level) => indoor.openLevel(key, level),
      close: (key) => indoor.closeBuilding(key),
      state: () => ({ open: indoor.openLevels(), focus: indoor.focusedBuilding(), selected: indoor.selectedPlace() }),
      select: (uid) => indoor.selectPlace(uid),
      // Route between two rooms / points (uids), or a building id for either end.
      route: (from, to) => {
        const end = (kind, value) => {
          const entry = placeEntry(value);
          const feature = entry ? directory.building(entry.buildingId) : data.render.buildings.features.find((item) => String(item.properties.id) === String(value));
          if (feature) setEndpoint(kind, feature, entry ? value : null);
          return Boolean(feature);
        };
        return end("source", from) && end("destination", to);
      },
      trip: () => trip
    }),
    displayRoute: () => displayRoute,
    fadedBuildings: () => routeOcclusion.fadedIds(),
    modelReplacedBuildings: () => routeOcclusion.replacedIds(),
    buildingModels: () => buildingModels.state(),
    walkPose: () => walkController.getPose(),
    walkOpen: (position, heading) => walkController.open(position, { heading }),
    walkClose: () => walkController.close(),
    walkView: () => walkController.getView(),
    walkSetView: (view) => walkController.setView(view),
    blockerAt: (position) => collisionWorld.blockerAt(position),
    navigation: Object.freeze({
      start: (view = "map") => navigation.start({ view }),
      end: () => navigation.end(),
      state: () => navigation.state(),
      feedPosition: (lngLat, options) => navigation.feedPosition(lngLat, options),
      feedCompass: (heading, accuracy) => navigation.feedCompass(heading, accuracy)
    })
  });
}

start().catch((error) => {
  console.error("Map initialization failed:", error);
  const status = document.querySelector("#map-status");
  if (status) status.textContent = "The map could not start";
  document.querySelector("#status-chip")?.removeAttribute("hidden");
  document.querySelector(".status-dot")?.classList.add("error");
});
