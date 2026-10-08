// Floor plans on the map: which buildings are open and on which floor, the floor
// selector, choosing rooms and points, and the indoor part of a route.
//
// A building with floors (a folder in the organisation's data, see levels.js) is
// drawn from outside until a floor is chosen: with the floor selector (it appears
// for the building at the centre of the view, or the selected one), by a search
// result, by a route, or by zooming far in. Opening a
// floor hides the building's shell (extrusion or GLB model) and draws that floor's
// plan at ground level. Several buildings can be open at once (a route from one
// building to another shows both); the floor selector controls one of them.
// Selecting another building takes the selector away from a building with floors
// and shows that building from outside again, unless the route runs through it.
import * as maplibregl from "maplibre-gl";
import { orientedFootprint } from "../buildings/building-footprint.js";
import { planarDistanceMeters } from "../utils/geo-utils.js";
import { DEG, geometryPolygons, insideRings, normalizeDegrees } from "../utils/local-frame.js";
import { orgDataPath } from "../core/org.js";
import { fetchPublicJSON } from "../core/paths.js";
import { axisBearings, cameraForPoints, circlePoints } from "../map/camera-fit.js";
import { FIT_PADDING } from "../map/fit-padding.js";
import { ROUTE_LAYERS } from "../map/layer-ids.js";
import { createFloorControl } from "./floor-control.js";
import { addIndoorLayers, INDOOR_HIT_LAYERS, INDOOR_SOURCE, setIndoorData, setIndoorRoute, setIndoorWalkView } from "./indoor-layers.js";
import { INDOOR_STYLE } from "./indoor-model.js";
import { createIndoorStore } from "./indoor-store.js";
import { CONNECTOR_CLASSES } from "./levels.js";
import { createPlaceCard } from "./place-card.js";

const FOCUS_ZOOM = 17.2; // from this zoom the building at the centre of the view gets the floor selector
const FOCUS_REACH_M = 30; // ... also when the centre is this near its footprint centre
const AUTO_OPEN_ZOOM = 19.2; // zooming in this far opens the building at the centre (org.json "floors.auto_open_zoom")
const FLOOR_LAYERS = ["indoor-floor", "indoor-corridor", "indoor-walls"];
const FLOOR_MAX_ZOOM = 20.5; // a floor plan is framed at most this close
const PLACE_REACH_M = 8; // a chosen room or point is framed with this much around it
const PLACE_ZOOM = [19.4, 20.8]; // ... between these zooms
// Location pin on the chosen room or point.
const PIN = '<svg viewBox="0 0 32 42" aria-hidden="true"><path d="M16 1.5C8 1.5 1.5 7.9 1.5 15.8 1.5 26.4 16 40.5 16 40.5S30.5 26.4 30.5 15.8C30.5 7.9 24 1.5 16 1.5Z" fill="#ea4335" stroke="#fff" stroke-width="2.5"/><circle cx="16" cy="15.5" r="5.6" fill="#7f1d1d"/></svg>';

// The floor's files, fetched from the organisation's data folder (revalidated, so
// a floor saved again from QGIS is read fresh).
async function fetchLevelFiles(building, level) {
  const read = (file) => fetchPublicJSON(orgDataPath(`${building.entry.folder}/${level.id}/${file}`));
  const { files } = level;
  const [outline, corridor, walls, doors, furniture, pois, units] = await Promise.all([
    files.level ? read(files.level) : null,
    Promise.all(files.corridor.map(read)),
    Promise.all(files.walls.map(read)),
    Promise.all(files.doors.map(read)),
    Promise.all((files.furniture || []).map(read)),
    Promise.all(files.pois.map(async (file) => ({ file, data: await read(file) }))),
    Promise.all(files.units.map(async (unit) => ({ ...unit, data: await read(unit.file) })))
  ]);
  return { level: outline, corridor, walls, doors, furniture, pois, units };
}

// getBuildingFeature(id)   the buildings-file feature with that id (render copy), or null
// setHiddenShells(ids)     hides the shells of those buildings (render ids); [] shows all
// isBusy()                 true while floors must not open by themselves (walk mode, navigation)
// onPlaceShown(place)      a room or point was selected (the building card should close)
// onPlaceHidden()          the card of the selected room or point went
// onRoutePlace(kind, uid)  "Directions" / "Start here" on the place card
// onChange()               the open floors changed
// onFloorPick(key, level)  a floor was chosen on the floor selector: true when it is
//                          handled elsewhere (walk mode takes the walker to that floor)
// onExteriorPick(key)      the same for the outside-view button of the selector
export function createIndoor({ map, org, getBuildingFeature, setHiddenShells, isBusy = () => false, onPlaceShown, onPlaceHidden, onRoutePlace, onChange, onMessage, onFloorPick, onExteriorPick }) {
  const store = createIndoorStore({ org, loadFiles: fetchLevelFiles, footprintOf: (building) => getBuildingFeature(building.buildingId)?.geometry || null });
  const hasFloors = store.buildings.length > 0;
  const open = new Map(); // building key -> shown floor id
  const models = new Map(); // building key -> the shown floor's model
  const dismissed = new Set(); // buildings closed by hand: not opened again by zooming in
  const markers = [];
  const autoOpenZoom = org.floors?.auto_open_zoom === undefined ? AUTO_OPEN_ZOOM : org.floors.auto_open_zoom;
  let generation = 0;
  let pinned = null; // building the floor selector stays on (selected or opened last)
  let selectedBuilding = null; // key of the building selected on the map, when it has floors
  let otherSelected = false; // the building selected on the map has no floor plans
  let focus = null;
  let selected = null; // uid of the selected room or point
  let hovered = null;
  let endpoints = { source: null, destination: null };
  let legs = []; // indoor legs of the current route
  let walkView = false;
  const orientations = new Map(); // building key -> bearing of its long axis

  if (hasFloors) addIndoorLayers(map, { beforeId: map.getLayer(ROUTE_LAYERS.casing) ? ROUTE_LAYERS.casing : undefined });

  const pinElement = document.createElement("div");
  pinElement.className = "place-pin";
  pinElement.innerHTML = PIN;
  pinElement.setAttribute("role", "img");
  const pin = new maplibregl.Marker({ element: pinElement, anchor: "bottom", offset: [0, -8] });
  let pinUid = null; // the room or point the pin stands on

  const floorControl = createFloorControl({
    onSelect: (levelId) => focus && !onFloorPick?.(focus, levelId) && openLevel(focus, levelId),
    onExterior: () => focus && !onExteriorPick?.(focus) && closeBuilding(focus)
  });
  const placeCard = createPlaceCard({
    onClose: () => clearSelection(),
    onHide: () => onPlaceHidden?.(),
    onSetSource: (place) => onRoutePlace?.("source", place.uid),
    onSetDestination: (place) => onRoutePlace?.("destination", place.uid)
  });

  const featureOf = (building) => getBuildingFeature(building.buildingId);
  const levelOf = (key, levelId) => store.building(key)?.levelById.get(levelId) || null;
  const levelShort = (key, levelId) => levelOf(key, levelId)?.short || levelId;
  const buildingName = (key) => store.building(key)?.name || key;

  // ---- Which building the floor selector is for ------------------------------------
  function buildingNear(lngLat) {
    let nearest = null;
    for (const building of store.buildings) {
      const feature = featureOf(building);
      if (feature ? geometryPolygons(feature.geometry).some((rings) => insideRings(lngLat, rings)) : inBox(lngLat, building.entry.bbox)) return building;
      const centre = building.entry.center;
      const d = centre ? planarDistanceMeters(lngLat, centre, lngLat[1]) : Infinity;
      if (d <= FOCUS_REACH_M && (!nearest || d < nearest.d)) nearest = { building, d };
    }
    return nearest?.building || null;
  }
  const inBox = (point, box) => Boolean(box) && point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];

  function routeLevels(key) {
    const ids = new Set();
    for (const leg of legs) {
      if (leg.building !== key) continue;
      if (leg.type === "walk") ids.add(leg.level); else { ids.add(leg.fromLevel); ids.add(leg.toLevel); }
    }
    return ids;
  }

  function updateFocus() {
    if (!hasFloors) return;
    // While a building without floor plans is selected, the selector is not offered for
    // a building that is only in view: it stays on one whose floor is open (a route's).
    if (otherSelected && pinned && !open.has(pinned)) pinned = null;
    const under = !otherSelected && map.getZoom() >= FOCUS_ZOOM ? buildingNear(map.getCenter().toArray()) : null;
    let key = under?.key || null;
    // The selector stays on a building that is open or selected; one that was closed
    // keeps it only while it is still in view at a close zoom.
    if (pinned && !open.has(pinned) && pinned !== selectedBuilding) {
      const centre = store.building(pinned)?.entry.center;
      if (!centre || map.getZoom() < 16.5 || !map.getBounds().contains(centre)) pinned = null;
    }
    if (!key && pinned && store.building(pinned)) key = pinned;
    if (!key && open.size) key = [...open.keys()].at(-1);
    focus = key;
    const building = key ? store.building(key) : null;
    if (!building) { floorControl.hide(); return; }
    floorControl.show({ building, levels: building.levels, active: open.get(key) ?? null, routeLevels: routeLevels(key) });
  }

  // ---- Drawing the open floors ------------------------------------------------------
  function applyStates() {
    const set = (uid, value) => { if (uid) map.setFeatureState({ source: INDOOR_SOURCE, id: uid }, value); };
    map.removeFeatureState({ source: INDOOR_SOURCE });
    set(selected, { selected: true });
    set(endpoints.source, { routeSource: true });
    set(endpoints.destination, { routeDestination: true });
    showPin();
  }

  // The location pin on the chosen room or point (not where a route pin stands,
  // and not while walking). It drops in when it moves to another place.
  function showPin() {
    const place = selected && !walkView && selected !== endpoints.source && selected !== endpoints.destination ? models.get(selected.split("/")[0])?.place(selected) : null;
    if (!place) { pin.remove(); pinUid = null; return; }
    pin.setLngLat(place.point);
    pinElement.setAttribute("aria-label", `Chosen: ${place.name || place.classLabel}`);
    if (pinUid !== place.uid) {
      pinElement.classList.remove("place-pin-drop");
      void pinElement.offsetWidth; // restarts the animation
      pinElement.classList.add("place-pin-drop");
    }
    pin.addTo(map);
    pinUid = place.uid;
  }

  // ---- Framing ------------------------------------------------------------------------
  // Bearing of a building's long axis (its footprint), the axes a floor is framed along.
  function orientationOf(key) {
    if (!orientations.has(key)) {
      const footprint = orientedFootprint(featureOf(store.building(key)));
      orientations.set(key, footprint ? normalizeDegrees(Math.atan2(footprint.u[0], footprint.u[1]) / DEG) % 180 : null);
    }
    return orientations.get(key);
  }
  const bearingsOf = (key) => (orientationOf(key) === null ? null : axisBearings(orientationOf(key)));

  // The outline of a building's floor (the open floor's, else the footprint, else its
  // box), at the floor and at the top of its walls.
  function outlinePoints(key) {
    const building = store.building(key);
    const polygons = models.get(key)?.floor?.length ? models.get(key).floor : geometryPolygons(featureOf(building)?.geometry);
    let ring = polygons.flatMap((rings) => rings[0] || []);
    const box = building?.entry.bbox;
    if (!ring.length && box) ring = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
    return ring.flatMap((point) => [[point[0], point[1], 0], [point[0], point[1], INDOOR_STYLE.wallHeightM]]);
  }

  // A room (its outline) or point, with PLACE_REACH_M around it.
  function placePoints(place) {
    const outline = place.kind === "unit" ? place.polygons.flatMap((rings) => rings[0]) : [];
    return [...outline, ...circlePoints(place.point, PLACE_REACH_M)];
  }

  // What the View presets keep in view (camera-controls.js): the chosen room or
  // point, else the open floor of the building the floor selector is on; or null.
  function cameraFocus() {
    const place = selected ? models.get(selected.split("/")[0])?.place(selected) : null;
    if (place) return { kind: "place", building: place.building, points: placePoints(place), orientation: orientationOf(place.building), padding: FIT_PADDING.place, maxZoom: PLACE_ZOOM[1] };
    const key = focus && open.has(focus) ? focus : [...open.keys()].at(-1);
    if (!key) return null;
    return { kind: "floor", building: key, buildingId: store.building(key)?.buildingId ?? null, points: outlinePoints(key), orientation: orientationOf(key), padding: FIT_PADDING.building, maxZoom: FLOOR_MAX_ZOOM };
  }

  function drawRoute() {
    markers.splice(0).forEach((marker) => marker.remove());
    if (!hasFloors) return;
    const features = [];
    for (const leg of legs) {
      const shownLevel = open.get(leg.building);
      if (shownLevel === undefined) continue; // the building is shown from outside
      if (leg.type === "walk") {
        features.push({ type: "Feature", properties: { shown: shownLevel === leg.level }, geometry: { type: "LineString", coordinates: leg.coordinates } });
        continue;
      }
      // Lift or stairs: a button on the floor where the route leaves, and one where it arrives.
      const kind = CONNECTOR_CLASSES[leg.class]?.label || "Stairs";
      const add = (point, label, title, target, arriving) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `floor-change${arriving ? " floor-change-arriving" : ""}`;
        element.innerHTML = label;
        element.title = title;
        element.setAttribute("aria-label", title);
        element.addEventListener("click", (event) => { event.stopPropagation(); openLevel(leg.building, target); });
        markers.push(new maplibregl.Marker({ element, anchor: "bottom", offset: [0, -14] }).setLngLat(point).addTo(map));
      };
      const arrow = leg.direction === "up" ? "↑" : "↓";
      if (shownLevel === leg.fromLevel) add(leg.point, `<b>${arrow}</b> ${levelShort(leg.building, leg.toLevel)}`, `${kind} ${leg.direction} to ${levelOf(leg.building, leg.toLevel)?.name || leg.toLevel}: show that floor`, leg.toLevel, false);
      else if (shownLevel === leg.toLevel) add(leg.toPoint, `from ${levelShort(leg.building, leg.fromLevel)}`, `Arriving by ${kind.toLowerCase()} from ${levelOf(leg.building, leg.fromLevel)?.name || leg.fromLevel}: show that floor`, leg.fromLevel, true);
    }
    setIndoorRoute(map, { type: "FeatureCollection", features });
  }

  async function refresh() {
    if (!hasFloors) return;
    const token = ++generation;
    const wanted = [...open];
    const loaded = await Promise.all(wanted.map(([key, levelId]) => store.level(key, levelId).catch((error) => {
      console.warn(`Floor ${levelId} of ${buildingName(key)} could not be loaded.`, error);
      onMessage?.(`The floor plan of ${buildingName(key)} could not be loaded`);
      return null;
    })));
    if (token !== generation) return;
    models.clear();
    const render = [], labels = [];
    wanted.forEach(([key, levelId], index) => {
      const model = loaded[index];
      if (!model) { if (open.get(key) === levelId) open.delete(key); return; }
      models.set(key, model);
      render.push(...model.render.features);
      labels.push(...model.labels.features);
    });
    setIndoorData(map, { type: "FeatureCollection", features: render }, { type: "FeatureCollection", features: labels });
    setHiddenShells([...models.keys()].map((key) => featureOf(store.building(key))?.properties?.render_id).filter((id) => id !== undefined && id !== null).map(String));
    if (selected && !models.get(selected.split("/")[0])?.place(selected)) { selected = null; placeCard.hide(); }
    applyStates();
    drawRoute();
    updateFocus();
    onChange?.();
  }

  // Brings a building's floor into view, as large as the free part of the screen
  // allows: turned along the building's axes when that shows it clearly larger (a
  // long building runs up a phone held upright). Nothing moves while the view is
  // already on the building about that close.
  function frame(key) {
    const building = store.building(key);
    const points = outlinePoints(key);
    if (!building || !points.length) return;
    const camera = cameraForPoints(map, points, { pitch: Math.min(map.getPitch(), 52), bearings: bearingsOf(key), keepBearing: true, minGain: 0.15, padding: FIT_PADDING.building(), maxZoom: FLOOR_MAX_ZOOM });
    if (!camera) return;
    const box = building.entry.bbox;
    if (map.getZoom() >= camera.zoom - 0.35 && (!box || inBox(map.getCenter().toArray(), box))) return;
    map.flyTo({ ...camera, duration: 900, essential: true });
  }

  // Shows a floor of a building (and hides the building's shell).
  async function openLevel(key, levelId, { fit = true } = {}) {
    const building = store.building(key);
    const level = building?.levelById.get(levelId) || building?.defaultLevel;
    if (!level) return false;
    if (selected && selected.split("/")[0] === key && open.get(key) !== level.id) { selected = null; placeCard.hide(); }
    open.set(key, level.id);
    pinned = key;
    dismissed.delete(key);
    await refresh();
    if (fit && open.has(key)) frame(key);
    return open.get(key) === level.id;
  }

  function closeBuilding(key, { remember = true } = {}) {
    if (!open.has(key)) return;
    open.delete(key);
    if (remember) dismissed.add(key);
    if (selected && selected.split("/")[0] === key) { selected = null; placeCard.hide(); }
    refresh();
  }

  function closeAll() {
    if (!open.size && !selected) return;
    open.clear();
    selected = null;
    pinned = selectedBuilding;
    placeCard.hide();
    refresh();
  }

  // ---- Rooms and points ---------------------------------------------------------------
  // Selects a room or point (opening its floor first) and shows its card.
  async function selectPlace(uid, { fly = true } = {}) {
    const [key, levelId] = String(uid).split("/");
    const building = store.building(key);
    if (!building || !building.levelById.has(levelId)) return false;
    if (open.get(key) !== levelId && !(await openLevel(key, levelId, { fit: false }))) return false;
    const place = models.get(key)?.place(uid);
    if (!place) return false;
    selected = uid;
    applyStates();
    placeCard.show(place, { building: building.name, level: building.levelById.get(levelId).name });
    onPlaceShown?.(place);
    // The place in the middle of what the card and the panels leave free, close up,
    // with its pin (the card is shown first, so it counts).
    if (fly) {
      const camera = cameraForPoints(map, placePoints(place), { pitch: Math.min(Math.max(map.getPitch(), 30), 50), bearings: bearingsOf(key), keepBearing: true, minGain: 0.15, padding: FIT_PADDING.place(), minZoom: PLACE_ZOOM[0], maxZoom: PLACE_ZOOM[1] });
      if (camera) map.flyTo({ ...camera, speed: 0.8, curve: 1.2, essential: true });
    }
    return true;
  }

  function clearSelection() {
    if (!selected) { placeCard.hide(); return; }
    selected = null;
    placeCard.hide();
    applyStates();
  }

  // The room or point drawn at a screen point: its uid, or null.
  function placeAt(point) {
    if (!models.size) return null;
    const hits = map.queryRenderedFeatures(point, { layers: INDOOR_HIT_LAYERS.filter((id) => map.getLayer(id)) });
    return hits.find((feature) => feature.properties?.uid)?.properties.uid || null;
  }
  const onOpenFloor = (point) => models.size > 0 && map.queryRenderedFeatures(point, { layers: FLOOR_LAYERS.filter((id) => map.getLayer(id)) }).length > 0;

  // A map click: true when it was on an open floor plan (a room or point is
  // selected, or the selection is cleared), so nothing else should react to it.
  function handleClick(event) {
    const uid = placeAt(event.point);
    if (uid) { selectPlace(uid, { fly: false }); return true; }
    if (!onOpenFloor(event.point)) return false;
    clearSelection();
    return true;
  }

  // Pointer move: highlights the room under the pointer; true when one is.
  function handleMove(event) {
    const uid = placeAt(event.point);
    if (uid !== hovered) {
      if (hovered) map.setFeatureState({ source: INDOOR_SOURCE, id: hovered }, { hover: false });
      hovered = uid;
      if (hovered) map.setFeatureState({ source: INDOOR_SOURCE, id: hovered }, { hover: true });
    }
    return Boolean(uid) || onOpenFloor(event.point);
  }

  if (hasFloors) {
    map.on("moveend", () => {
      const zoom = map.getZoom();
      if (autoOpenZoom && zoom < autoOpenZoom - 0.8) dismissed.clear();
      // Not while another building is selected: its neighbour would open instead of it.
      const under = autoOpenZoom && zoom >= autoOpenZoom && !otherSelected && !isBusy() ? buildingNear(map.getCenter().toArray()) : null;
      if (under && !open.has(under.key) && !dismissed.has(under.key) && under.defaultLevel) openLevel(under.key, under.defaultLevel.id, { fit: false });
      else updateFocus();
    });
  }

  return {
    store,
    hasFloors,
    openLevel,
    closeBuilding,
    closeAll,
    selectPlace,
    clearSelection,
    placeAt,
    handleClick,
    handleMove,
    levelShort,
    buildingName,
    isOpen: (key) => open.has(key),
    openLevels: () => Object.fromEntries(open),
    selectedPlace: () => selected,
    focusedBuilding: () => focus,
    cameraFocus,
    // Walk mode sees the open floors from inside (indoor-layers.js), without the pin.
    setWalkView(on) {
      walkView = on;
      if (hasFloors) { setIndoorWalkView(map, on); showPin(); }
    },
    // A building was selected on the map: the floor selector follows it, and floor
    // plans open in other buildings close (those the route runs through stay).
    buildingSelected(feature) {
      const building = feature ? store.forBuildingId(feature.properties?.id) : null;
      selectedBuilding = building?.key || null;
      otherSelected = Boolean(feature) && !building;
      if (feature) {
        pinned = selectedBuilding;
        const left = [...open.keys()].filter((key) => key !== selectedBuilding && !routeLevels(key).size);
        left.forEach((key) => open.delete(key));
        if (left.length) refresh();
      }
      updateFocus();
    },
    // Indoor legs of the current route (trip.js results), or [] to clear.
    setRouteLegs(next) {
      legs = next || [];
      drawRoute();
      updateFocus();
    },
    // uids of the rooms the route starts and ends at (or null), tinted like route buildings.
    setEndpoints(next) {
      endpoints = { source: next?.source || null, destination: next?.destination || null };
      placeCard.setRoute(endpoints);
      if (hasFloors) applyStates();
    },
    // A floor file changed on disk (development): read it again. True when it was one.
    reloadFile(published) {
      const prefix = `data/${org.id}/`;
      if (!published.startsWith(prefix)) return false;
      const [folder, levelId] = published.slice(prefix.length).split("/");
      const building = store.buildings.find((item) => item.entry.folder === folder);
      if (!building || !building.levelById.has(levelId)) return false;
      store.forget(building.key, levelId);
      if (open.get(building.key) === levelId) refresh();
      return true;
    }
  };
}
