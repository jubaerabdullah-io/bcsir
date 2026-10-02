// Floor plans on the map: which buildings are open and on which floor, the floor
// selector, choosing rooms and points, and the indoor part of a route.
//
// A building with floors (a folder in the organisation's data, see levels.js) is
// drawn from outside until a floor is chosen: with the floor selector (it appears
// for the building at the centre of the view, or the selected one), from the
// building card, by a search result, by a route, or by zooming far in. Opening a
// floor hides the building's shell (extrusion or GLB model) and draws that floor's
// plan at ground level. Several buildings can be open at once (a route from one
// building to another shows both); the floor selector controls one of them.
import * as maplibregl from "maplibre-gl";
import { pointInRings } from "../geo-utils.js";
import { orgDataPath } from "../org.js";
import { publicAssetUrl } from "../paths.js";
import { createFloorControl } from "./floor-control.js";
import { addIndoorLayers, INDOOR_HIT_LAYERS, INDOOR_SOURCE, setIndoorData, setIndoorRoute } from "./indoor-layers.js";
import { createIndoorStore } from "./indoor-store.js";
import { CONNECTOR_CLASSES } from "./levels.js";
import { createPlaceCard } from "./place-card.js";

const FOCUS_ZOOM = 17.2; // from this zoom the building at the centre of the view gets the floor selector
const FOCUS_REACH_M = 30; // ... also when the centre is this near its footprint centre
const AUTO_OPEN_ZOOM = 19.2; // zooming in this far opens the building at the centre (org.json "floors.auto_open_zoom")
const FLOOR_LAYERS = ["indoor-floor", "indoor-corridor", "indoor-walls"];
const polygonsOf = (geometry) => (geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : []);
const metres = (a, b) => Math.hypot((b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (b[1] - a[1]) * 110574);

// The floor's files, fetched from the organisation's data folder (revalidated, so
// a floor saved again from QGIS is read fresh).
async function fetchLevelFiles(building, level) {
  const read = async (file) => {
    const published = orgDataPath(`${building.entry.folder}/${level.id}/${file}`);
    const response = await fetch(publicAssetUrl(published), { cache: "no-cache" });
    if (!response.ok) throw new Error(`${published}: ${response.status} ${response.statusText}`);
    return response.json();
  };
  const { files } = level;
  const [outline, corridor, walls, doors, pois, units] = await Promise.all([
    files.level ? read(files.level) : null,
    Promise.all(files.corridor.map(read)),
    Promise.all(files.walls.map(read)),
    Promise.all(files.doors.map(read)),
    Promise.all(files.pois.map(async (file) => ({ file, data: await read(file) }))),
    Promise.all(files.units.map(async (unit) => ({ ...unit, data: await read(unit.file) })))
  ]);
  return { level: outline, corridor, walls, doors, pois, units };
}

// getBuildingFeature(id)   the buildings-file feature with that id (render copy), or null
// setHiddenShells(ids)     hides the shells of those buildings (render ids); [] shows all
// isBusy()                 true while floors must not open by themselves (walk mode, navigation)
// onPlaceShown(place)      a room or point was selected (the building card should close)
// onRoutePlace(kind, uid)  "Start here" / "Directions to here" on the place card
// onChange()               the open floors changed
export function createIndoor({ map, org, getBuildingFeature, setHiddenShells, isBusy = () => false, onPlaceShown, onRoutePlace, onChange, onMessage }) {
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
  let focus = null;
  let selected = null; // uid of the selected room or point
  let hovered = null;
  let endpoints = { source: null, destination: null };
  let legs = []; // indoor legs of the current route

  if (hasFloors) addIndoorLayers(map, { beforeId: map.getLayer("route-casing") ? "route-casing" : undefined });

  const floorControl = createFloorControl({
    onSelect: (levelId) => focus && openLevel(focus, levelId),
    onExterior: () => focus && closeBuilding(focus)
  });
  const placeCard = createPlaceCard({
    onClose: () => clearSelection(),
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
      if (feature ? polygonsOf(feature.geometry).some((rings) => pointInRings(lngLat, rings)) : inBox(lngLat, building.entry.bbox)) return building;
      const centre = building.entry.center;
      const d = centre ? metres(lngLat, centre) : Infinity;
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
    const under = map.getZoom() >= FOCUS_ZOOM ? buildingNear(map.getCenter().toArray()) : null;
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
    showFloorChips();
    onChange?.();
  }

  // Brings a building into view when it is far away or small on screen.
  function frame(key) {
    const building = store.building(key);
    const box = building?.entry.bbox;
    if (!box) return;
    const centre = map.getCenter().toArray();
    if (map.getZoom() >= 18.2 && inBox(centre, box)) return;
    const phone = window.innerWidth < 700;
    map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: phone ? { top: 150, bottom: 150, left: 30, right: 80 } : { top: 140, bottom: 90, left: 80, right: 150 }, maxZoom: 20, pitch: Math.min(map.getPitch(), 52), bearing: map.getBearing(), duration: 900, essential: true });
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
    placeCard.show(place, { building: building.name, level: building.levelById.get(levelId).name, sample: building.sample });
    onPlaceShown?.(place);
    if (fly) map.flyTo({ center: place.point, zoom: Math.max(map.getZoom(), 19.4), pitch: Math.min(Math.max(map.getPitch(), 40), 55), bearing: map.getBearing(), speed: 0.8, curve: 1.2, essential: true });
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

  // ---- Building card: one chip per floor ------------------------------------------------
  const floorChips = document.querySelector("#building-floor-chips");
  let cardBuilding = null;
  function renderBuildingFloors(feature) {
    showFloorChips(feature ? store.forBuildingId(feature.properties?.id) : null);
  }
  function showFloorChips(building = cardBuilding) {
    cardBuilding = building;
    document.querySelector("#building-floors").hidden = !building;
    if (!building) return;
    floorChips.innerHTML = building.levels.map((level) => `<button class="floor-chip" type="button" data-level="${level.id}" aria-pressed="${open.get(building.key) === level.id}" title="Show ${level.name}">${level.short}</button>`).join("");
  }
  floorChips?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-level]");
    if (chip && cardBuilding) openLevel(cardBuilding.key, chip.dataset.level);
  });

  if (hasFloors) {
    map.on("moveend", () => {
      const zoom = map.getZoom();
      if (autoOpenZoom && zoom < autoOpenZoom - 0.8) dismissed.clear();
      const under = autoOpenZoom && zoom >= autoOpenZoom && !isBusy() ? buildingNear(map.getCenter().toArray()) : null;
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
    // A building was selected on the map: the floor selector follows it.
    buildingSelected(feature) {
      renderBuildingFloors(feature);
      const building = feature ? store.forBuildingId(feature.properties?.id) : null;
      selectedBuilding = building?.key || null;
      if (building) pinned = building.key;
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
