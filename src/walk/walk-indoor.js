// Walk mode inside buildings that have floor plans.
//
// Outdoors every building is solid. A building with floor plans opens when the
// walker comes near one of its entrances: its shell is hidden and the floor of that
// entrance is drawn, as when a floor is chosen on the map (indoor-controller.js).
// He walks in through the entrance and is then inside: on that floor, between its
// walls and through its doors (navigation/collision.js). The room he walks into is
// named. At a lift or stairs, the floor selector (or Page Up / Page Down) takes him
// to another floor it reaches. He leaves through an entrance, and the building
// closes again when he has walked away from it.
//
// A walk started by clicking inside such a building starts inside it: on its open
// floor, else on the floor it opens on. When the walk ends, the floors that were
// open before it are open again.
import { planarDistanceMeters } from "../utils/geo-utils.js";
import { geometryPolygons, insideRings } from "../utils/local-frame.js";
import { INDOOR_STYLE } from "../indoor/indoor-model.js";
import { levelWalkSpace, shaftLevels, shaftNear, unitAt, walkEntrances } from "../indoor/walk-space.js";

const OPEN_M = 12; // a building opens when an entrance is this near
const CLOSE_M = 20; // and closes when the walker is outside and this far from its entrances
const INDOOR_PACE = 0.6; // share of the outdoor walking speed inside a building
// The follow camera inside: kept this far from a wall, as near the walker as that
// takes, and standing in for him (he is hidden) when it comes nearer than `solo`.
const INDOOR_CAMERA = { margin: 0.35, min: 0.2, solo: 1.4 };

const metres = (a, b) => planarDistanceMeters(a, b, a[1]);

// indoor                 the floor plans (indoor-controller.js)
// getBuildingFeature(id) the buildings-file feature with that id, or null
// getWorld()             the walk collision (navigation/collision.js)
// getWalk()              walk mode (walk-mode.js)
// isEnabled()            false keeps every building solid
export function createWalkIndoor({ indoor, getBuildingFeature, getWorld, getWalk, isEnabled = () => true, onToast }) {
  const store = indoor.store;
  const spaces = new Map(); // "<building key>/<floor>" -> { site, level, model, space }
  const loading = new Map();
  const state = { indoor: null }; // of the collision: { buildingId, level } while inside
  let sites = null; // buildings that can be walked into
  let begun = false;
  let before = {}; // floors open when the walk began
  let opened = null; // { site, level }: the building opened for the walker
  let inside = null; // { site, level }: where he is
  let room = null; // uid of the room he is in
  let shaft = null; // the lift or stairs he stands at
  let hinted = new Set();
  let change = 0; // id of the floor change under way

  const toast = (message) => onToast?.(message);
  const walking = () => Boolean(getWalk()?.isActive());
  const levelName = (site, levelId) => site.building.levelById.get(levelId)?.name || levelId;
  const spaceId = (site, levelId) => `${site.building.key}/${levelId}`;
  const siteById = (id) => (sites || []).find((site) => site.id === String(id)) || null;
  const register = ({ site, level, space }) => getWorld()?.setIndoor({ buildingId: site.id, ...space, level });

  function findSites() {
    return store.buildings.map((building) => {
      const feature = getBuildingFeature(building.buildingId);
      if (!feature) return null;
      return { building, id: String(feature.properties.render_id ?? feature.properties.id), name: building.name, polygons: geometryPolygons(feature.geometry), entrances: walkEntrances(building, feature) };
    }).filter(Boolean);
  }

  // Loads a floor for walking (once) and adds it to the collision.
  function ensure(site, levelId) {
    const id = spaceId(site, levelId);
    if (spaces.has(id)) return Promise.resolve(spaces.get(id));
    if (!loading.has(id)) {
      loading.set(id, store.level(site.building.key, levelId).then((model) => {
        const entry = { site, level: levelId, model, space: levelWalkSpace(model, { entrances: site.entrances.filter((entrance) => entrance.level === levelId).map((entrance) => entrance.point) }) };
        spaces.set(id, entry);
        register(entry);
        return entry;
      }).finally(() => loading.delete(id)));
    }
    return loading.get(id);
  }

  // The floors a walk can start or enter on: those with an entrance, the floor each
  // building opens on, and the floors open now.
  function preload() {
    sites = sites || findSites();
    const openNow = indoor.openLevels();
    for (const site of sites) {
      const levels = new Set(site.entrances.map((entrance) => entrance.level));
      if (site.building.defaultLevel) levels.add(site.building.defaultLevel.id);
      if (openNow[site.building.key] !== undefined) levels.add(openNow[site.building.key]);
      levels.forEach((levelId) => ensure(site, levelId).catch((error) => console.warn(`${site.name}: floor ${levelId} could not be loaded for walking.`, error)));
    }
  }

  function begin() {
    if (begun) return;
    begun = true;
    sites = findSites();
    before = indoor.openLevels();
    state.indoor = null;
    opened = inside = shaft = room = null;
    hinted = new Set();
    preload();
  }

  function end() {
    if (!begun) return;
    begun = false;
    change += 1;
    state.indoor = null;
    opened = inside = shaft = room = null;
    if (JSON.stringify(indoor.openLevels()) === JSON.stringify(before)) return;
    indoor.closeAll();
    Object.entries(before).forEach(([key, levelId]) => indoor.openLevel(key, levelId, { fit: false }));
  }

  // The walker is inside `site` on `level`: its floor is shown, its other floors are read.
  function arrive(site, level) {
    if (opened && opened.site !== site) indoor.closeBuilding(opened.site.building.key, { remember: false });
    opened = { site, level };
    inside = { site, level };
    room = shaft = null;
    indoor.openLevel(site.building.key, level, { fit: false });
    site.building.levels.forEach((entry) => ensure(site, entry.id).catch(() => {}));
  }

  function approach(position) {
    if (opened) {
      const away = Math.min(...opened.site.entrances.map((entrance) => metres(position, entrance.point)));
      if (away <= CLOSE_M) return;
      indoor.closeBuilding(opened.site.building.key, { remember: false });
      opened = null;
    }
    if (!isEnabled()) return;
    let nearest = null;
    for (const site of sites) for (const entrance of site.entrances) {
      const d = metres(position, entrance.point);
      if (d <= OPEN_M && (!nearest || d < nearest.d)) nearest = { site, entrance, d };
    }
    if (!nearest) return;
    const { site, entrance } = nearest;
    const mine = opened = { site, level: entrance.level };
    ensure(site, entrance.level).then(() => { if (opened === mine && begun) indoor.openLevel(site.building.key, entrance.level, { fit: false }); }).catch(() => {});
    if (!hinted.has(site.id)) { hinted.add(site.id); toast(`${site.name}: walk in through ${entrance.name}.`); }
  }

  // After every move of the walker (walk mode's onPose).
  function track(pose) {
    if (!begun || !sites || !pose?.position || !walking()) return;
    const now = state.indoor;
    if (now && inside?.site.id !== now.buildingId) {
      const site = siteById(now.buildingId);
      if (!site) return;
      arrive(site, now.level);
      toast(`Inside ${site.name}, ${levelName(site, now.level)}.${site.building.levels.length > 1 ? " A lift or the stairs take you to the other floors." : ""}`);
    } else if (!now && inside) {
      toast(`You left ${inside.site.name}.`);
      inside = shaft = room = null;
    }
    if (!inside) { approach(pose.position); return; }

    const { site, level } = inside;
    const entry = spaces.get(spaceId(site, level));
    const unit = entry ? unitAt(entry.model, pose.position) : null;
    if ((unit?.uid ?? null) !== room) {
      room = unit?.uid ?? null;
      const number = unit?.properties?.room_number;
      if (unit?.name) toast(number ? `${unit.name} · Room ${number}` : unit.name);
    }
    const at = shaftNear(site.building, level, pose.position);
    if (at !== shaft) {
      shaft = at;
      if (shaft && shaftLevels(site.building, shaft).length > 1) toast(`${shaft.name || "Stairs"}: choose a floor on the floor selector, or press Page Up / Page Down.`);
    }
  }

  // Takes the walker to another floor by the lift or stairs he stands at.
  async function goToLevel(levelId) {
    if (!inside || levelId === inside.level) return false;
    const { site } = inside;
    if (!shaft) { toast("Walk to a lift or the stairs to change floor."); return false; }
    const stop = shaft.members.get(levelId);
    if (!stop) { toast(`${shaft.name || "This"} does not go to ${levelName(site, levelId)}.`); return false; }
    const id = ++change;
    try { await ensure(site, levelId); }
    catch (error) { console.warn(`${site.name}: floor ${levelId} could not be loaded for walking.`, error); toast(`${levelName(site, levelId)} could not be loaded`); return false; }
    if (id !== change || !inside || inside.site !== site || !walking()) return false;
    state.indoor = { buildingId: site.id, level: levelId };
    inside = opened = { site, level: levelId };
    room = null;
    getWalk().moveTo(getWorld().nearestIndoor(stop.point, site.id, levelId) || stop.point);
    await indoor.openLevel(site.building.key, levelId, { fit: false });
    toast(`${levelName(site, levelId)} · ${site.name}`);
    return true;
  }

  // One floor up (+1) or down (-1) by that lift or stairs.
  function changeFloor(step) {
    if (!inside) return;
    if (!shaft) { toast("Walk to a lift or the stairs to change floor."); return; }
    const stops = shaftLevels(inside.site.building, shaft);
    const target = stops[stops.findIndex((entry) => entry.id === inside.level) + step];
    if (target) goToLevel(target.id);
    else toast(`${shaft.name || "This"} goes no ${step > 0 ? "higher" : "lower"}.`);
  }

  return {
    // Adds the floors loaded so far to a collision world made anew.
    attach() { spaces.forEach(register); },
    preload,
    begin,
    end,
    track,
    changeFloor,
    goToLevel,
    // A walk started inside a building with floor plans starts inside it:
    // { position, message }; null for a start outdoors (open floors are closed).
    resolveStart(position) {
      begin();
      const site = isEnabled() ? sites.find((item) => item.polygons.some((rings) => insideRings(position, rings))) : null;
      const level = site ? indoor.openLevels()[site.building.key] ?? site.building.defaultLevel?.id : undefined;
      const spot = level === undefined ? null : getWorld().nearestIndoor(position, site.id, level);
      if (!spot) { indoor.closeAll(); return null; }
      state.indoor = { buildingId: site.id, level };
      arrive(site, level);
      return { position: spot, message: `Walking inside ${site.name}, ${levelName(site, level)}.` };
    },
    // Collision for walk mode. Walls inside are felt, not announced; a building with
    // floor plans that is walked into from the wrong side says where its entrance is.
    resolveMove(from, to) {
      const wasInside = Boolean(state.indoor);
      const result = getWorld().resolveMove(from, to, state, { enter: isEnabled() });
      if (!result.blocked) return result;
      if (wasInside || state.indoor) return { ...result, blocked: false };
      const site = result.blocker?.indoor && isEnabled() ? siteById(result.blocker.id) : null;
      return site?.entrances.length ? { ...result, blocker: { ...result.blocker, message: `${site.name}: go in through ${site.entrances[0].name}.` } } : result;
    },
    // Share of the way from the walker to the follow camera that is clear; inside,
    // the walls of his floor count and the camera stays in the room with him.
    cameraClearance(from, to) {
      const clear = getWorld().firstHit(from, to, state)?.t ?? 1;
      return state.indoor ? { clear, ...INDOOR_CAMERA } : clear;
    },
    // Why a walk started on a building with floor plans starts outside it, or null.
    startHint(buildingId) {
      const site = isEnabled() ? siteById(buildingId) : null;
      return site?.entrances.length ? `The walk starts outside ${site.name}: go in through ${site.entrances[0].name}.` : null;
    },
    floorElevation: () => (state.indoor ? INDOOR_STYLE.walkFloorM : 0),
    speedFactor: () => (state.indoor ? INDOOR_PACE : 1),
    levelLabel: () => (inside ? `${inside.site.building.shortName} ${inside.site.building.levelById.get(inside.level)?.short || inside.level}` : "Ground"),
    // The floor selector while walking: true when the choice was handled here.
    pickFloor(key, levelId) {
      if (!walking()) return false;
      // The keys go back to walking (and the button does not stay marked on another floor).
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (inside?.site.building.key === key) goToLevel(levelId);
      else toast(`Go inside ${store.building(key)?.name || "the building"} to change floor.`);
      return true;
    },
    pickExterior() {
      if (!walking()) return false;
      toast(inside ? "Walk out through an entrance to leave the building." : "The building closes when you walk away from it.");
      return true;
    },
    // Diagnostics for the browser tests.
    state: () => ({
      inside: inside ? { building: inside.site.building.key, level: inside.level } : null,
      opened: opened ? { building: opened.site.building.key, level: opened.level } : null,
      room,
      shaft: shaft?.id ?? null,
      loaded: [...spaces.keys()],
      entrances: (sites || []).flatMap((site) => site.entrances.map((entrance) => ({ building: site.building.key, ...entrance })))
    })
  };
}
