// Buildings drawn from realistic GLB models instead of their extrusion.
//
// A BuildingBoundary feature with a `building_model` property (a GLB in public/,
// e.g. "models/buildings/igcrt.glb") is drawn by that model; every other building
// keeps its extrusion.
//
//   BuildingBoundary.geojson feature (building_model, model_rotation, model_size,
//   base_m, top_m, entrance_coords)
//     -> footprint rectangle, front side and rotation (building-footprint.js)
//     -> one placement per building in the "buildings" model group, drawn by the
//        existing renderer (models3d.js) stretched to the footprint and to
//        top_m - base_m, shown and hidden with the building layers
//        (a module model, config BUILDING_MODELS.modules, is tiled instead: one
//        placement per bay and floor along the stepped footprint, tiledModelParts)
//     -> once that GLB has loaded: the building's extrusion is filtered out
//        (route-occlusion.js) and an invisible extrusion keeps it clickable
//        (bcsir-layers.js MODEL_HIT_LAYER)
// A GLB that fails to load leaves its building's extrusion in place, with a warning.
//
// Debug: add ?buildingDebug (or ?igcrtDebug) to the URL, or call
// window.bcsirBuildings.debug(true), to outline every model building's footprint
// (yellow), its rectangle and front direction (cyan), its anchor, and the placed
// model box (magenta, dashed).
import { BUILDING_MODELS } from "./config.js";
import { buildingModelPlacement, offsetLngLat, placedBoxCorners, tiledModelParts } from "./building-footprint.js";
import { whenModelLoaded } from "./models3d.js";
import { publicAssetUrl } from "./paths.js";

const TAG = "[Building 3D]";
const DEBUG_SOURCE = "building-models-debug";
const DEBUG_LAYERS = [
  { id: "building-models-debug-lines", type: "line", paint: { "line-color": ["match", ["get", "kind"], "footprint", "#facc15", "#22d3ee"], "line-width": 3 }, filter: ["all", ["==", ["geometry-type"], "LineString"], ["!=", ["get", "kind"], "model"]] },
  { id: "building-models-debug-model", type: "line", paint: { "line-color": "#d946ef", "line-width": 2, "line-dasharray": [2, 1.5] }, filter: ["==", ["get", "kind"], "model"] },
  { id: "building-models-debug-anchor", type: "circle", paint: { "circle-radius": 5, "circle-color": "#22d3ee", "circle-stroke-color": "#0f172a", "circle-stroke-width": 1.5 }, filter: ["==", ["geometry-type"], "Point"] }
];
const round = (value, digits = 2) => Number(value.toFixed(digits));
const nameOf = (feature) => {
  const p = feature.properties;
  return `${p.name_en_short || p.name_en || "Building"} (${p.id ?? p.render_id})`;
};

// getBuildings() returns the prepared BuildingBoundary collection (data.render.buildings);
// onReplacedChange(renderIds, wallGaps) hides those buildings' extrusions ([] shows
// them all); wallGaps are the openings in the drawn boundary wall for loaded models
// whose feature has wall_gap_m (a gate): [{ point: [lon, lat], halfWidth }].
export function createBuildingModels({ map, getBuildings, onReplacedChange, config = BUILDING_MODELS }) {
  let entries = []; // [{ renderId, feature, placement, url, parts }] (parts: tiled module, else null)
  const loads = new Map(); // url -> { status: "loading" | "ready" | "failed", box, fitBox }
  let replaced = [];
  let debugOn = false;

  function wallGaps() {
    return entries
      .filter((entry) => replaced.includes(entry.renderId) && Number(entry.feature.properties.wall_gap_m) > 0)
      .map((entry) => ({ point: entry.placement.anchor, halfWidth: Number(entry.feature.properties.wall_gap_m) / 2 }));
  }

  function applyReplaced() {
    const next = config.enabled === false ? [] : entries.filter((entry) => loads.get(entry.url)?.status === "ready").map((entry) => entry.renderId).sort();
    if (next.length === replaced.length && next.every((id, i) => id === replaced[i])) return;
    replaced = next;
    onReplacedChange?.(replaced, wallGaps());
  }

  // Module of a building_model path (leading "/" or "./" ignored), or null.
  const moduleOf = (model) => config.modules?.[String(model).replace(/^\.?\//, "")] || null;

  // Stretch of the GLB's footprint box to the building (1 = modelled to size); for a
  // tiled module, that of its most stretched part.
  function stretchOf(entry, fit = entry.placement.fit) {
    const load = loads.get(entry.url);
    if (!load?.fitBox) return null;
    if (entry.parts && fit === entry.placement.fit) {
      const worst = (s) => Math.max(...s.map((value) => Math.abs(value - 1)));
      return entry.parts.map((part) => stretchOf(entry, part.fit)).reduce((a, b) => (worst(b) > worst(a) ? b : a));
    }
    const width = load.fitBox.max.x - load.fitBox.min.x, height = load.fitBox.max.y - load.fitBox.min.y, depth = load.fitBox.max.z - load.fitBox.min.z;
    const sx = fit[0] / width, sz = fit[2] / depth;
    return [sx, fit[1] ? fit[1] / height : (sx + sz) / 2, sz];
  }

  function reportLoaded(url) {
    for (const entry of entries.filter((item) => item.url === url)) {
      const stretch = stretchOf(entry);
      const text = stretch ? stretch.map((s) => `${round(s * 100, 0)} %`).join(" x ") : "?";
      if (entry.parts) {
        console.info(`${TAG} ${nameOf(entry.feature)}: ${entry.placement.model} loaded; extrusion hidden. Tiled in ${entry.parts.length} bays and floors; the most stretched at ${text} of the module's size.`);
        continue;
      }
      const limit = Number(config.maxStretch) || 0.15;
      const log = stretch && stretch.some((s) => Math.abs(s - 1) > limit) ? console.warn : console.info;
      log(`${TAG} ${nameOf(entry.feature)}: ${entry.placement.model} loaded; extrusion hidden. Fitted width x height x depth at ${text} of the model's size${log === console.warn ? " (its proportions differ from the footprint; the model looks stretched)" : ""}.`);
    }
  }

  function watch(url) {
    if (loads.has(url)) return;
    loads.set(url, { status: "loading" });
    whenModelLoaded(url).then(
      ({ box, fitBox }) => {
        loads.set(url, { status: "ready", box, fitBox });
        reportLoaded(url);
        applyReplaced();
        drawDebug();
      },
      (error) => {
        loads.set(url, { status: "failed" });
        for (const entry of entries.filter((item) => item.url === url)) console.warn(`${TAG} Failed to load ${entry.placement.model} for ${nameOf(entry.feature)}; using standard extrusion.`, error);
        applyReplaced();
      }
    );
  }

  function compute() {
    entries = [];
    if (config.enabled === false) { applyReplaced(); return; }
    for (const feature of getBuildings()?.features || []) {
      if (!feature?.properties?.building_model) continue;
      const placement = buildingModelPlacement(feature);
      if (!placement) {
        console.warn(`${TAG} ${nameOf(feature)}: building_model ${JSON.stringify(feature.properties.building_model)} needs a .glb/.gltf path and a polygon; drawn as an extrusion.`);
        continue;
      }
      const module = moduleOf(placement.model);
      const parts = module ? tiledModelParts(feature, module) : null;
      entries.push({ renderId: String(feature.properties.render_id ?? feature.properties.id), feature, placement, url: publicAssetUrl(placement.model), parts: parts?.length ? parts : null });
    }
    if (entries.length) {
      console.info(`${TAG} ${entries.length} building${entries.length > 1 ? "s" : ""} drawn from GLB models:\n${entries.map(({ feature, placement: p, parts }) => (parts
        ? `  ${nameOf(feature)}: ${p.model} tiled in ${parts.length} parts: ${new Set(parts.map((part) => part.strip)).size} strips, ${Math.max(...parts.map((part) => part.floor)) + 1} floors of ${round(parts[0].fit[1])} m; front faces ${round((parts[0].rotation + 180) % 360, 1)}°`
        : `  ${nameOf(feature)}: ${p.model}; anchor [${round(p.anchor[0], 7)}, ${round(p.anchor[1], 7)}]; `
        + `fit ${round(p.fit[0])} x ${p.fit[1] === null ? "auto" : round(p.fit[1])} x ${round(p.fit[2])} m; rotation ${round(p.rotation, 2)}° (front faces ${round(p.frontBearing, 1)}°); `
        + `size ${p.size}; base ${p.base} m`
      )).join("\n")}`);
    }
    entries.forEach((entry) => watch(entry.url));
    applyReplaced();
  }

  // ---- Debug outline ------------------------------------------------------------------
  function debugData() {
    const features = [];
    for (const { feature, placement: p, parts } of entries) {
      const ring = p.footprint.corners.concat([p.footprint.corners[0]]);
      // The model box, or every ground-floor bay of a tiled module.
      const boxes = (parts ? parts.filter((part) => part.floor === 0) : [p]).map((item) => placedBoxCorners({ anchor: item.anchor, rotation: item.rotation, scale: parts ? 1 : p.size, minX: -item.fit[0] / 2, maxX: item.fit[0] / 2, minZ: -item.fit[2] / 2, maxZ: item.fit[2] / 2 }));
      const outline = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates[0][0] : feature.geometry.coordinates[0];
      features.push(
        { type: "Feature", properties: { kind: "footprint" }, geometry: { type: "LineString", coordinates: outline } },
        { type: "Feature", properties: { kind: "rectangle" }, geometry: { type: "LineString", coordinates: ring } },
        ...boxes.map((box) => ({ type: "Feature", properties: { kind: "model" }, geometry: { type: "LineString", coordinates: box.concat([box[0]]) } })),
        { type: "Feature", properties: { kind: "front" }, geometry: { type: "LineString", coordinates: [p.anchor, offsetLngLat(p.anchor, p.frontBearing, p.fit[2] / 2 + 12)] } },
        { type: "Feature", properties: { kind: "anchor" }, geometry: { type: "Point", coordinates: p.anchor } }
      );
    }
    return { type: "FeatureCollection", features };
  }

  function drawDebug() {
    if (!debugOn || !map.getStyle()) return;
    const data = debugData();
    if (map.getSource(DEBUG_SOURCE)) map.getSource(DEBUG_SOURCE).setData(data);
    else map.addSource(DEBUG_SOURCE, { type: "geojson", data });
    // Above the 3D models (added later), so the outlines show through the GLBs.
    DEBUG_LAYERS.forEach((layer) => { if (map.getLayer(layer.id)) map.moveLayer(layer.id); else map.addLayer({ ...layer, source: DEBUG_SOURCE }); });
  }

  function setDebug(on) {
    debugOn = Boolean(on);
    if (debugOn) { drawDebug(); console.info(TAG, state()); return; }
    DEBUG_LAYERS.forEach((layer) => map.getLayer(layer.id) && map.removeLayer(layer.id));
    if (map.getSource(DEBUG_SOURCE)) map.removeSource(DEBUG_SOURCE);
  }

  function state() {
    return entries.map((entry) => ({
      id: entry.feature.properties.id,
      renderId: entry.renderId,
      name: entry.feature.properties.name_en_short || entry.feature.properties.name_en,
      model: entry.placement.model,
      status: loads.get(entry.url)?.status ?? "loading",
      replaced: replaced.includes(entry.renderId),
      anchor: entry.placement.anchor,
      rotation: entry.placement.rotation,
      frontBearing: entry.placement.frontBearing,
      fit: entry.placement.fit,
      size: entry.placement.size,
      base: entry.placement.base,
      stretch: stretchOf(entry),
      parts: entry.parts?.length ?? null
    }));
  }

  compute();
  const query = new URLSearchParams(window.location.search);
  setDebug(query.has("buildingDebug") || query.has("igcrtDebug"));

  const api = {
    // Placement features for the "buildings" model group (model-placements.js).
    // A tiled module gives one placement per bay and floor.
    placements: () => entries.flatMap(({ renderId, feature, placement: p, parts }) => (parts
      ? parts.map((part, i) => ({
        type: "Feature",
        properties: { id: `building-${renderId}-${i}`, name: feature.properties.name_en ?? null, model: p.model, building_id: renderId, base_m: part.base, top_m: null, size: 1, scale: 1, rotation: part.rotation, building: true, fit: part.fit },
        geometry: { type: "Point", coordinates: part.anchor }
      }))
      : [{
        type: "Feature",
        properties: { id: `building-${renderId}`, name: feature.properties.name_en ?? null, model: p.model, building_id: renderId, base_m: p.base, top_m: null, size: p.size, scale: 1, rotation: p.rotation, building: true, fit: p.fit },
        geometry: { type: "Point", coordinates: p.anchor }
      }])),
    // BuildingBoundary changed (live reload during development).
    update() { compute(); onReplacedChange?.(replaced, wallGaps()); drawDebug(); },
    debug: setDebug,
    state
  };
  window.bcsirBuildings = Object.freeze({ state, debug: setDebug });
  return api;
}
