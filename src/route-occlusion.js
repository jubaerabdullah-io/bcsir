// See-through buildings where they hide the drawn route.
//
// The route line is drawn above the 3D layers, so a route that passes BEHIND a
// building is painted across that building, as if it went through it. Only
// the buildings that stand between the camera and the route are made
// see-through: points along the route are projected to the screen and the
// buildings drawn at those pixels are found with queryRenderedFeatures (which
// tests the extruded 3D shape). A route point inside a building's own
// footprint (the dashed leg into the destination building) does not count.
// Those buildings move into the *-route-faded layers (bcsir-layers.js) by
// filter; every other building, and all buildings once the route is cleared,
// keep their original layers and opacity. The set is recalculated at most
// every THROTTLE_MS while the camera moves, and only changed filters are set.
import { ROUTE_FADED_LAYERS } from "./bcsir-layers.js";
import { createLocalFrame, geometryPolygons, insideRings } from "./navigation/local-frame.js";

const SAMPLE_SPACING_M = 4;
const MAX_SAMPLES = 72;
const THROTTLE_MS = 280;
const BUILDING_LAYERS = ["buildings-body", "buildings-roof"];
const EDGE_LAYERS = ["buildings-roof-seams", "buildings-corners"];

// getViewpoint() -> { position, heading } of a first-person camera (walk mode),
// or null: route points behind that camera are skipped (projected, they would
// land on the screen mirrored).
export function createRouteOcclusion(map, { getFeature, getViewpoint } = {}) {
  let samples = []; // [{ lngLat, local }]
  let frame = null;
  let faded = [];
  let timer = 0;
  let last = 0;

  function sample(lines) {
    const points = [];
    const all = (lines || []).filter((line) => Array.isArray(line) && line.length > 1);
    if (!all.length) return [];
    frame = createLocalFrame(all[0][0]);
    all.forEach((line) => {
      const local = line.map(frame.toLocal);
      for (let i = 1; i < local.length; i += 1) {
        const [a, b] = [local[i - 1], local[i]];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const count = Math.max(1, Math.ceil(length / SAMPLE_SPACING_M));
        for (let k = i === 1 ? 0 : 1; k <= count; k += 1) {
          const t = k / count;
          const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          points.push({ local: point, lngLat: frame.toLngLat(point) });
        }
      }
    });
    if (points.length <= MAX_SAMPLES) return points;
    const step = points.length / MAX_SAMPLES;
    return Array.from({ length: MAX_SAMPLES }, (_, i) => points[Math.floor(i * step)]);
  }

  function insideOwnFootprint(id, lngLat) {
    const feature = getFeature?.(id);
    return Boolean(feature && geometryPolygons(feature.geometry).some((rings) => insideRings(lngLat, rings)));
  }

  function apply(ids) {
    if (ids.length === faded.length && ids.every((id, i) => id === faded[i])) return;
    faded = ids;
    const list = ["literal", ids];
    const inFaded = ["in", ["get", "render_id"], list];
    const byParent = ["in", ["get", "parent_id"], list];
    if (map.getLayer(ROUTE_FADED_LAYERS.body)) map.setFilter(ROUTE_FADED_LAYERS.body, inFaded);
    if (map.getLayer(ROUTE_FADED_LAYERS.roof)) map.setFilter(ROUTE_FADED_LAYERS.roof, inFaded);
    BUILDING_LAYERS.forEach((id) => map.getLayer(id) && map.setFilter(id, ids.length ? ["!", inFaded] : null));
    EDGE_LAYERS.forEach((id) => map.getLayer(id) && map.setFilter(id, ids.length ? ["!", byParent] : null));
  }

  function compute() {
    const layers = [...BUILDING_LAYERS, ROUTE_FADED_LAYERS.body, ROUTE_FADED_LAYERS.roof]
      .filter((id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none");
    if (!samples.length || !layers.length) { apply([]); return; }
    const canvas = map.getCanvas();
    const width = canvas.clientWidth, height = canvas.clientHeight;
    // Only points in front of a first-person camera.
    const viewpoint = getViewpoint?.();
    const eye = viewpoint?.position ? frame.toLocal(viewpoint.position) : null;
    const angle = (viewpoint?.heading ?? 0) * Math.PI / 180;
    const forward = [Math.sin(angle), Math.cos(angle)];
    const ids = new Set();
    for (const { lngLat, local } of samples) {
      if (eye && (local[0] - eye[0]) * forward[0] + (local[1] - eye[1]) * forward[1] <= 1) continue;
      const point = map.project(lngLat);
      if (!(point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height)) continue;
      for (const hit of map.queryRenderedFeatures(point, { layers })) {
        const id = hit.properties?.render_id;
        if (id === undefined || id === null || ids.has(String(id))) continue;
        if (insideOwnFootprint(String(id), lngLat)) continue;
        ids.add(String(id));
      }
    }
    apply([...ids].sort());
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; last = performance.now(); compute(); }, Math.max(0, THROTTLE_MS - (performance.now() - last)));
  }

  map.on("move", schedule);
  map.on("moveend", schedule);

  return {
    // lines: drawn route parts ([[lon, lat], ...] each), or null to restore all buildings.
    setRoute(lines) {
      samples = sample(lines);
      if (!samples.length) { clearTimeout(timer); timer = 0; apply([]); return; }
      // Wait for the camera change that usually follows a new route.
      schedule();
    },
    refresh: schedule,
    fadedIds: () => [...faded]
  };
}
