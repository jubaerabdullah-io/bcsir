// The buildings with floor plans of the open organisation: their floors (loaded
// when first needed), their rooms and points, and routes inside them.
//
// Works from the organisation's index (scripts/lib/catalog.mjs): `indoor` lists the
// buildings and floors, `places` every named room and point. Floor geometry is
// only read when a floor is opened or routed through; `loadFiles` does the reading
// (fetch in the browser, the file system in tests), so this module has no DOM.
import { planarDistanceMeters } from "../utils/geo-utils.js";
import { buildLevelModel, floorColor } from "./indoor-model.js";
import { createBuildingRouter, groupShafts } from "./indoor-router.js";
import { defaultLevel, sortLevels } from "./levels.js";

// Height of every floor's slab above the ground, by floor id. The lowest floor that
// is not a basement lies on the ground (at `base`), and each floor above it one
// storey higher: the ground storey is `groundHeight` high and the others
// `floorHeight` (building.json "ground_height_m", "floor_height_m"); without those
// the building's height (top - base) is shared out evenly, so the top floor lies one
// storey under the roof. Basements are drawn on the ground. With no height known
// (top <= base) every floor lies on the ground.
export function floorElevations(levels, { base = 0, top = 0, groundHeight = null, floorHeight = null } = {}) {
  const above = sortLevels(levels).filter((level) => level.ordinal >= 0);
  const storeys = above.length ? above : sortLevels(levels);
  const height = Math.max(0, top - base);
  const even = storeys.length ? height / storeys.length : 0;
  const first = groundHeight > 0 ? groundHeight : floorHeight > 0 ? floorHeight : even;
  const next = floorHeight > 0 ? floorHeight : groundHeight > 0 ? groundHeight : even;
  const elevations = new Map(levels.map((level) => [level.id, base]));
  storeys.forEach((level, index) => {
    const raised = index === 0 ? 0 : first + (index - 1) * next;
    // Never above the roof: a floor too many for the building's height stays under it.
    elevations.set(level.id, base + (height > 0 ? Math.min(raised, Math.max(0, height - 1)) : 0));
  });
  return elevations;
}

// org: the organisation's index. loadFiles(building, level) resolves to the floor's
// parsed files ({ level, corridor: [], units: [{ file, class, data }], walls: [],
// pois: [{ file, data }], doors: [] }). footprintOf(building) returns the building's
// footprint geometry (used when a floor has no outline file), or null.
// heightOf(building) returns { base, top } of the building in metres, or null: the
// floors then lie at their heights in the building (floorElevations), else on the ground.
export function createIndoorStore({ org, loadFiles, footprintOf = () => null, heightOf = () => null }) {
  const places = org?.places || [];
  const placeByUid = new Map(places.map((place) => [place.uid, place]));
  const buildings = (org?.indoor || []).map((entry) => {
    const own = places.filter((place) => place.building === entry.key);
    // Every floor has a colour of its own, by its place in the building (indoor-model.js).
    const levels = sortLevels(entry.levels).map((level, index) => ({ ...level, color: floorColor(index) }));
    return {
      key: entry.key,
      entry,
      buildingId: entry.building_id,
      name: entry.name,
      shortName: entry.short_name || entry.name,
      sample: entry.sample === true,
      levels,
      defaultLevel: defaultLevel(levels),
      levelById: new Map(levels.map((level) => [level.id, level])),
      shafts: groupShafts(own.filter((place) => place.connector).map((place) => ({ uid: place.uid, class: place.connector, name: place.name, level: place.level, point: place.point, connector_id: place.connector_id }))),
      entrances: own.filter((place) => place.class === "entrance"),
      models: new Map() // level id -> Promise<level model>
    };
  });
  const byKey = new Map(buildings.map((building) => [building.key, building]));
  const byBuildingId = new Map(buildings.filter((building) => building.buildingId !== null).map((building) => [String(building.buildingId), building]));

  // Height (m above the ground) of a floor's slab in its building. Worked out when
  // first asked for: the buildings file is read by then.
  function elevation(key, levelId) {
    const building = byKey.get(key);
    if (!building) return 0;
    if (!building.elevations) {
      const size = heightOf(building);
      building.elevations = floorElevations(building.levels, { base: Number(size?.base) || 0, top: Number(size?.top) || 0, groundHeight: building.entry.ground_height_m, floorHeight: building.entry.floor_height_m });
    }
    return building.elevations.get(levelId) ?? 0;
  }

  // The prepared floor (indoor-model.js). A floor that fails to load is retried next time.
  function level(key, levelId) {
    const building = byKey.get(key);
    const entry = building?.levelById.get(levelId);
    if (!entry) return Promise.reject(new Error(`No floor ${levelId} in ${key}`));
    if (!building.models.has(levelId)) {
      const promise = Promise.resolve(loadFiles(building, entry)).then((files) => {
        const model = buildLevelModel({ buildingKey: key, level: { ...entry, elevation: elevation(key, levelId) }, files, footprint: footprintOf(building) });
        if (model.problems.length) console.warn(`${building.entry.folder}/${levelId}: some features were skipped.\n  ${model.problems.join("\n  ")}`);
        return model;
      });
      promise.catch(() => building.models.delete(levelId));
      building.models.set(levelId, promise);
    }
    return building.models.get(levelId);
  }

  // The door of a building for someone outside: its entrance point nearest `near`
  // ([lon, lat], e.g. where the outdoor route arrives), else the walkable place
  // nearest `near` on the floor the building opens on. Resolves to a routing
  // anchor ({ level, point, cell, label }) or null.
  async function entranceAnchor(key, near = null) {
    const building = byKey.get(key);
    if (!building) return null;
    const entrances = [...building.entrances].sort((a, b) => (near ? planarDistanceMeters(a.point, near) - planarDistanceMeters(b.point, near) : (building.levelById.get(a.level)?.ordinal ?? 0) - (building.levelById.get(b.level)?.ordinal ?? 0)));
    for (const entrance of entrances) {
      const anchor = (await level(key, entrance.level)).anchorFor(entrance.uid);
      if (anchor) return { ...anchor, entrance: true };
    }
    const ground = building.defaultLevel;
    if (!ground) return null;
    const model = await level(key, ground.id);
    const anchor = model.anchorAt(near || building.entry.center, "Entrance", 60);
    return anchor ? { ...anchor, entrance: true, assumed: true } : null;
  }

  // A place is known by "<building key>/<floor>/<file>/<feature>", so a room that has
  // no name (and so is not in the search list) can still be routed to.
  async function placeAnchor(uid) {
    const [key, levelId] = String(uid).split("/");
    if (!byKey.get(key)?.levelById.has(levelId)) return null;
    return (await level(key, levelId)).anchorFor(uid);
  }

  // Route inside one building between two anchors. Only the two floors are loaded
  // first; when no lift or stair joins them directly, the other floors are loaded
  // as well so the route can change between shafts on the way.
  async function routeBetween(key, from, to, { stepFree = false } = {}) {
    const building = byKey.get(key);
    if (!building || !from || !to) return { ok: false, reason: "not-reachable" };
    const attempt = async (levelIds) => {
      const loaded = new Map();
      await Promise.all(levelIds.map(async (id) => loaded.set(id, await level(key, id))));
      const router = createBuildingRouter({
        key,
        shafts: building.shafts,
        levels: building.levels.map((entry) => ({ id: entry.id, ordinal: entry.ordinal, short: entry.short, name: entry.name, grid: loaded.get(entry.id)?.grid || null }))
      });
      return router.route(from, to, { stepFree });
    };
    let result = await attempt([...new Set([from.level, to.level])]);
    if (!result.ok && from.level !== to.level && building.levels.length > 2) result = await attempt(building.levels.map((entry) => entry.id));
    // A found route names the door it uses at each end (indoor-router.js).
    return { from, to, ...result, building: key };
  }

  return {
    buildings,
    building: (key) => byKey.get(key) || null,
    // The indoor building of a buildings-file feature id, or null.
    forBuildingId: (id) => (id === null || id === undefined ? null : byBuildingId.get(String(id)) || null),
    places,
    place: (uid) => placeByUid.get(uid) || null,
    level,
    elevation,
    // The buildings file changed: the floors' heights are worked out again.
    forgetHeights() { buildings.forEach((building) => { building.elevations = null; building.models.clear(); }); },
    entranceAnchor,
    placeAnchor,
    routeBetween,
    // Forget a floor's loaded files (live reload during development).
    forget(key, levelId) { byKey.get(key)?.models.delete(levelId); }
  };
}
