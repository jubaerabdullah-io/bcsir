// Ids of the MapLibre layers that more than one module names.
//
// The layers are added by bcsir-layers.js (the site), indoor/indoor-layers.js (floor
// plans) and three/models3d.js (GLB models). Other modules hit-test them, set their
// filters, add layers before them or keep them on top; they take the ids from here,
// so each id is written once. A layer only its own module names (the ground layers,
// the floor slabs) keeps its id there. Pure module (no imports).

export const BUILDING_LAYERS = {
  footprint: "buildings-footprint",
  body: "buildings-body",
  roof: "buildings-roof",
  seams: "buildings-roof-seams",
  corners: "buildings-corners"
};

// See-through copies of the building layers. route-occlusion.js moves the
// buildings that hide the drawn route into them (by filter); they hold no
// building otherwise.
export const ROUTE_FADED_LAYERS = { body: "buildings-body-route-faded", roof: "buildings-roof-route-faded" };

// Invisible extrusion (opacity 0: never drawn, still hit-tested) of the buildings
// drawn by a GLB model instead (building-models.js), so clicking the model selects the
// building as before. Empty until a model has loaded.
export const MODEL_HIT_LAYER = "buildings-model-hit";

export const LABEL_LAYERS = { major: "building-labels-major", minor: "building-labels-minor" };
export const ROUTE_LAYERS = { casing: "route-casing", line: "route-line", access: "route-access" };
export const GARDEN_LAYER = "garden-3d";

// The custom layer that draws every GLB model (three/models3d.js).
export const MODELS_LAYER = "3d-models";

// Floor-plan layers (indoor/indoor-layers.js) that are picked from or kept on top.
export const INDOOR_LAYERS = {
  units: "indoor-units",
  routeOther: "indoor-route-other",
  routeCasing: "indoor-route-casing",
  routeLine: "indoor-route-line",
  labels: "indoor-unit-labels",
  pois: "indoor-pois"
};

// Line and symbol layers that stay above the GLB models, bottom to top
// (models3d.js keepMapOverlaysOnTop): indoor routes and labels, the route, building labels.
export const OVERLAY_LAYERS = [
  INDOOR_LAYERS.routeOther,
  INDOOR_LAYERS.routeCasing,
  INDOOR_LAYERS.routeLine,
  INDOOR_LAYERS.labels,
  INDOOR_LAYERS.pois,
  ROUTE_LAYERS.casing,
  ROUTE_LAYERS.line,
  ROUTE_LAYERS.access,
  LABEL_LAYERS.major,
  LABEL_LAYERS.minor
];
