// The buildings with floor plans of the open organisation: their floors (loaded
// when first needed), their rooms and points, and routes inside them.
//
// Works from the organisation's index (scripts/lib/catalog.mjs): `indoor` lists the
// buildings and floors, `places` every named room and point. Floor geometry is
// only read when a floor is opened or routed through; `loadFiles` does the reading
// (fetch in the browser, the file system in tests), so this module has no DOM.
import { buildLevelModel, distanceMetres } from "./indoor-model.js";
import { createBuildingRouter, groupShafts } from "./indoor-router.js";
import { defaultLevel, sortLevels } from "./levels.js";

// org: the organisation's index. loadFiles(building, level) resolves to the floor's
// parsed files ({ level, corridor: [], units: [{ file, class, data }], walls: [],
// pois: [{ file, data }], doors: [] }). footprintOf(building) returns the building's
// footprint geometry (used when a floor has no outline file), or null.
export function createIndoorStore({ org, loadFiles, footprintOf = () => null }) {
  const places = org?.places || [];
  const placeByUid = new Map(places.map((place) => [place.uid, place]));
  const buildings = (org?.indoor || []).map((entry) => {
    const own = places.filter((place) => place.building === entry.key);
    const levels = sortLevels(entry.levels);
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

  // The prepared floor (indoor-model.js). A floor that fails to load is retried next time.
  function level(key, levelId) {
    const building = byKey.get(key);
    const entry = building?.levelById.get(levelId);
    if (!entry) return Promise.reject(new Error(`No floor ${levelId} in ${key}`));
    if (!building.models.has(levelId)) {
      const promise = Promise.resolve(loadFiles(building, entry)).then((files) => {
        const model = buildLevelModel({ buildingKey: key, level: entry, files, footprint: footprintOf(building) });
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
    const entrances = [...building.entrances].sort((a, b) => (near ? distanceMetres(a.point, near) - distanceMetres(b.point, near) : (building.levelById.get(a.level)?.ordinal ?? 0) - (building.levelById.get(b.level)?.ordinal ?? 0)));
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
    return { ...result, building: key, from, to };
  }

  return {
    buildings,
    building: (key) => byKey.get(key) || null,
    // The indoor building of a buildings-file feature id, or null.
    forBuildingId: (id) => (id === null || id === undefined ? null : byBuildingId.get(String(id)) || null),
    places,
    place: (uid) => placeByUid.get(uid) || null,
    level,
    entranceAnchor,
    placeAnchor,
    routeBetween,
    // Forget a floor's loaded files (live reload during development).
    forget(key, levelId) { byKey.get(key)?.models.delete(levelId); }
  };
}
