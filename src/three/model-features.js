// From placement features (GeoJSON) to the renderer's placements.
//
// A placement feature is a Point with a "model" path and optional base_m, top_m,
// scale, size and rotation (model-placements.js collects them from the datasets;
// building-models.js adds the building models with building, building_id and fit).
// prepareModels() validates them and resolves each model's address; buildSignature()
// tells whether a set changed. Reused from the reference project's models3d.js.
import { modelPath as orgModelPath } from "../core/org.js";
import { publicAssetUrl } from "../core/paths.js";
import { normalizeDegrees } from "../utils/local-frame.js";

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeId(value) {
  const cleaned = String(value ?? "model")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "model";
}

// "models/tree.glb" in the data is the open organisation's public/models/<org>/tree.glb.
function resolveModelUrl(modelPath) {
  return publicAssetUrl(orgModelPath(modelPath));
}
function firstFinite(properties, names) {
  for (const name of names) {
    const value = toFiniteNumber(properties?.[name]);
    if (value !== null) return value;
  }
  return null;
}

// `fit`: [width, height, depth] in metres (height may be null), or null.
function fitSizeOf(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const size = value.map(toFiniteNumber);
  return size[0] > 0 && size[2] > 0 ? size : null;
}

export function resolveSizeMultiplier(value) {
  const size = toFiniteNumber(value);
  if (size === null || size === 0) return 1;
  return size > 0 ? size : 1 / (1 + Math.abs(size));
}

/*
  Simple placement logic (reference)
  ----------------------------------
  A model has ONE map position only.  No separate pivot is needed.

  Preferred GeoJSON form:
    geometry: { type: "Point", coordinates: [longitude, latitude] }

  Also accepted when a non-spatial table is used:
    properties: { lon: 90.39, lat: 23.75 }

  rotation is a yaw in degrees and may be any value. It is normalized to
  0..359.999 and rotates the object around its own horizontal centre.

  base_m is the altitude of the model bottom; top_m (optional) fits the model
  height between base_m and top_m. size is a uniform multiplier: 1 preserves the
  rendered size, 0.5 halves it and 2 doubles it.
*/
function getModelPosition(feature) {
  const properties = feature?.properties || {};
  const propertyLongitude = firstFinite(properties, ["lon", "lng", "longitude", "model_lon", "model_lng"]);
  const propertyLatitude = firstFinite(properties, ["lat", "latitude", "model_lat"]);

  if (propertyLongitude !== null && propertyLatitude !== null) {
    return { longitude: propertyLongitude, latitude: propertyLatitude };
  }

  if (feature?.geometry?.type === "Point" && Array.isArray(feature.geometry.coordinates)) {
    const longitude = toFiniteNumber(feature.geometry.coordinates[0]);
    const latitude = toFiniteNumber(feature.geometry.coordinates[1]);
    if (longitude !== null && latitude !== null) return { longitude, latitude };
  }

  return null;
}

function normalizeFeatures(features) {
  const seen = new Map();
  const entries = [];

  (features || []).forEach((feature, index) => {
    if (!feature) return;
    const position = getModelPosition(feature);
    if (!position) return;

    const properties = feature.properties || {};
    const fallbackId = [
      properties.model || "model",
      position.longitude,
      position.latitude,
      index
    ].join("-");

    const originalId = safeId(properties.id || fallbackId);
    const count = seen.get(originalId) || 0;
    seen.set(originalId, count + 1);
    const id = count ? `${originalId}__${count + 1}` : originalId;

    entries.push({ id, feature, position });
  });

  return entries;
}

export function buildSignature(entries) {
  return JSON.stringify(
    entries.map(({ id, feature, position }) => {
      const properties = feature.properties || {};
      return {
        id,
        model: properties.model ?? null,
        longitude: position.longitude,
        latitude: position.latitude,
        base_m: properties.base_m ?? null,
        top_m: properties.top_m ?? null,
        scale: properties.scale ?? null,
        size: properties.size ?? null,
        rotation: normalizeDegrees(properties.rotation),
        building: properties.building === true,
        building_id: properties.building_id ?? null,
        fit: fitSizeOf(properties.fit)
      };
    })
  );
}

// key: the name of the set the placements belong to (models3d.js sync3DModels).
export function prepareModels(data, key) {
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("models.geojson must be a GeoJSON FeatureCollection.");
  }

  const entries = normalizeFeatures(data.features);
  const preparedModels = [];

  for (const { id, feature, position } of entries) {
    const properties = feature.properties || {};

    if (!properties.model) {
      console.warn(`Skipping model "${id}": no model path.`);
      continue;
    }

    preparedModels.push({
      modelId: id,
      sourceKey: key,
      url: resolveModelUrl(properties.model),
      longitude: position.longitude,
      latitude: position.latitude,
      baseM: toFiniteNumber(properties.base_m) ?? 0,
      topM: toFiniteNumber(properties.top_m),
      scale: toFiniteNumber(properties.scale) ?? 1,
      size: toFiniteNumber(properties.size) ?? 1,
      rotation: normalizeDegrees(properties.rotation),
      building: properties.building === true,
      // BuildingBoundary render_id of a building model (setFadedModelBuildings)
      buildingId: properties.building_id === undefined || properties.building_id === null ? null : String(properties.building_id),
      fitSize: fitSizeOf(properties.fit)
    });
  }

  if ((data.features || []).length > 0 && preparedModels.length === 0) {
    throw new Error("No valid 3D model features found. Use one lon/lat position and a model path.");
  }

  return { entries, preparedModels };
}
