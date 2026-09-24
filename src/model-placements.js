// GLB models configured directly in GeoJSON.
//
// A feature places a model when its properties contain "model" (a public URL
// such as "/models/escalators.glb", i.e. public/models/escalators.glb):
//   - Point feature       -> one model at the point
//   - MultiPoint feature  -> one model at every point
//   - any other geometry  -> models only at explicit "model_points"
//                            ([[lon, lat], ...]); positions are never guessed
// Placement properties (read by models3d.js, the reference renderer):
//   base_m    altitude of the model bottom, metres (default 0)
//   top_m     optional; if greater than base_m the model is scaled so its
//             height fits between base_m and top_m
//   size      extra uniform multiplier: 0 or missing = 1 (no change), 2 = double,
//             0.5 = half; negative values shrink (-1 = 0.5x, -3 = 0.25x)
//   scale     optional base scale when top_m is not used (default 1)
//   rotation  yaw in degrees, clockwise seen from above, around the model centre
//
// Models of a layer group are loaded the first time that group is visible, and
// every GLB file is downloaded once however many placements use it.
import { load3DModels, set3DModelsVisible } from "./models3d.js";
import { parseNumber } from "./visual-properties.js";

const MODEL_EXTENSION = /\.(glb|gltf)(?:[?#].*)?$/i;
const validLngLat = (point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;

// Turns every model-carrying feature of one or more collections into Point
// placements for models3d.js. Returns { collection, problems }.
export function collectModelPlacements(sources) {
  const features = [];
  const problems = [];
  for (const { label, collection } of sources) {
    (collection?.features || []).forEach((feature, index) => {
      const p = feature?.properties || {};
      if (p.model === undefined || p.model === null || p.model === "") return;
      const featureId = p.id ?? feature.id ?? `#${index + 1}`;
      const where = `${label} feature ${featureId}`;
      if (typeof p.model !== "string" || !MODEL_EXTENSION.test(p.model.trim())) {
        problems.push(`${where}: model must be a .glb or .gltf URL, got ${JSON.stringify(p.model)}`);
        return;
      }
      let points = [];
      if (Array.isArray(p.model_points)) points = p.model_points;
      else if (feature.geometry?.type === "Point") points = [feature.geometry.coordinates];
      else if (feature.geometry?.type === "MultiPoint") points = feature.geometry.coordinates;
      else {
        problems.push(`${where}: a ${feature.geometry?.type || "feature without geometry"} needs "model_points" ([[lon, lat], ...]) to place a model`);
        return;
      }
      const numeric = {};
      for (const key of ["base_m", "top_m", "size", "scale", "rotation"]) {
        if (p[key] === undefined || p[key] === null || p[key] === "") continue;
        const value = parseNumber(p[key]);
        if (value === null) problems.push(`${where}: ${key} must be a number, got ${JSON.stringify(p[key])}`);
        else numeric[key] = value;
      }
      if (numeric.scale !== undefined && numeric.scale <= 0) { problems.push(`${where}: scale must be positive`); delete numeric.scale; }
      if (numeric.top_m !== undefined && numeric.top_m <= (numeric.base_m ?? 0)) { problems.push(`${where}: top_m must be greater than base_m; using the model's own height`); delete numeric.top_m; }
      points.forEach((point, pointIndex) => {
        if (!validLngLat(point)) { problems.push(`${where}: invalid coordinate ${JSON.stringify(point)}`); return; }
        features.push({
          type: "Feature",
          properties: {
            id: `${label}-${featureId}${points.length > 1 ? `-${pointIndex + 1}` : ""}`,
            name: p.name ?? p.name_en ?? null,
            model: p.model.trim(),
            base_m: numeric.base_m ?? 0,
            top_m: numeric.top_m ?? null,
            size: numeric.size ?? 0,
            scale: numeric.scale ?? 1,
            rotation: numeric.rotation ?? 0
          },
          geometry: { type: "Point", coordinates: [Number(point[0]), Number(point[1])] }
        });
      });
    });
  }
  return { collection: { type: "FeatureCollection", features }, problems };
}

// One model set per layer group. `groups` maps a group id to dataset keys, and
// getDatasets() returns the latest loaded collections (data.raw).
export function createModelGroups({ map, groups, getDatasets, labels = {} }) {
  const visible = new Map();
  const loaded = new Set();
  const keyOf = (groupId) => `geojson-models:${groupId}`;

  async function sync(groupId) {
    const datasets = getDatasets();
    const sources = groups[groupId].map((key) => ({ label: labels[key] || key, collection: datasets[key] }));
    const { collection, problems } = collectModelPlacements(sources);
    if (problems.length) console.warn(`3D models (${groupId}): some features were skipped or corrected.\n  ${problems.join("\n  ")}`);
    await load3DModels(map, keyOf(groupId), { data: collection });
    loaded.add(groupId);
    return collection.features.length;
  }

  return {
    keyOf,
    // Called by the layer manager; loads a group's models the first time it is shown.
    async setVisible(groupId, next) {
      if (!groups[groupId]) return;
      visible.set(groupId, next);
      set3DModelsVisible(map, next, keyOf(groupId));
      if (next && !loaded.has(groupId)) await sync(groupId);
    },
    // Called when a dataset file changes (live reload during development).
    async refreshDataset(datasetKey) {
      const affected = Object.keys(groups).filter((groupId) => groups[groupId].includes(datasetKey) && loaded.has(groupId));
      for (const groupId of affected) await sync(groupId);
    },
    loadedGroups: () => [...loaded]
  };
}
