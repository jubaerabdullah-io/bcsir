// Hover, selection and route endpoints for BCSIR buildings.
// Adapted from the reference project's src/interactions-redesign.js: the same
// feature-state flags (hover, selected, routeSource, routeDestination), the same
// selectFeature()/setSourceFeature()/setDestinationFeature() API, applied to the
// "buildings" source instead of shops.
// BCSIR additions: clear one route endpoint, swap the endpoints, and a pick mode
// in which the next building clicked on the map is handed to the directions
// panel ("choose on map") instead of being selected.
import { polygonCentroid } from "./geo-utils.js";

// The *-route-faded layers hold the buildings that are shown see-through
// because they hide the drawn route (route-occlusion.js).
const BUILDING_LAYERS = ["buildings-roof", "buildings-body", "buildings-roof-route-faded", "buildings-body-route-faded", "building-labels-major", "building-labels-minor"];
const featureId = (feature) => feature?.properties?.render_id ?? feature?.id ?? null;

export function setupInteractions(map, { resolveFeature, onSelect, onClear, onHover, onHoverLeave, onRouteChange, isEnabled = () => true }) {
  let hoveredId = null, selectedId = null, sourceFeature = null, destinationFeature = null, pickHandler = null;

  function setState(id, next) {
    if (id === null) return;
    try { if (map.getSource("buildings")) map.setFeatureState({ source: "buildings", id: String(id) }, next); }
    catch (error) { console.warn("Building state failed", error); }
  }
  // Features from queryRenderedFeatures() carry serialized properties; always use
  // the canonical feature object from the loaded dataset.
  const canonical = (feature) => resolveFeature?.(featureId(feature)) || feature;
  function routeSnapshot() { return { source: sourceFeature, destination: destinationFeature }; }
  function emitRoute() { onRouteChange?.(routeSnapshot()); }

  function selectFeature(feature, fly = true) {
    feature = canonical(feature);
    if (!feature) return;
    const id = featureId(feature);
    if (id === null) return;
    if (selectedId !== null && String(selectedId) !== String(id)) setState(selectedId, { selected: false });
    selectedId = String(id);
    setState(selectedId, { selected: true });
    if (fly) {
      const center = polygonCentroid(feature);
      if (center) map.flyTo({ center, zoom: Math.max(map.getZoom(), 18), pitch: Math.max(map.getPitch(), 55), bearing: map.getBearing(), speed: .75, curve: 1.25, essential: true });
    }
    onSelect?.(feature);
  }
  function clearSelection() { if (selectedId !== null) setState(selectedId, { selected: false }); selectedId = null; onClear?.(); }
  function setEndpoint(previous, next, flag) {
    const oldId = featureId(previous), newId = featureId(next);
    if (oldId !== null && String(oldId) !== String(newId)) setState(oldId, { [flag]: false });
    if (newId !== null) setState(newId, { [flag]: true });
  }
  function setSourceFeature(feature) { feature = canonical(feature); if (!feature) return; setEndpoint(sourceFeature, feature, "routeSource"); sourceFeature = feature; emitRoute(); }
  function setDestinationFeature(feature) { feature = canonical(feature); if (!feature) return; setEndpoint(destinationFeature, feature, "routeDestination"); destinationFeature = feature; emitRoute(); }
  function clearSourceFeature() { const id = featureId(sourceFeature); if (id !== null) setState(id, { routeSource: false }); sourceFeature = null; emitRoute(); }
  function clearDestinationFeature() { const id = featureId(destinationFeature); if (id !== null) setState(id, { routeDestination: false }); destinationFeature = null; emitRoute(); }
  function swapRouteEndpoints() {
    const previousSource = sourceFeature, previousDestination = destinationFeature;
    if (featureId(previousSource) !== null) setState(featureId(previousSource), { routeSource: false });
    if (featureId(previousDestination) !== null) setState(featureId(previousDestination), { routeDestination: false });
    sourceFeature = previousDestination; destinationFeature = previousSource;
    if (featureId(sourceFeature) !== null) setState(featureId(sourceFeature), { routeSource: true });
    if (featureId(destinationFeature) !== null) setState(featureId(destinationFeature), { routeDestination: true });
    emitRoute();
  }
  // handler(feature) receives the next building clicked on the map; null cancels.
  function setPickHandler(handler) {
    pickHandler = typeof handler === "function" ? handler : null;
    map.getCanvas().style.cursor = pickHandler ? "crosshair" : "";
  }
  function clearRouteSelection() {
    const sourceId = featureId(sourceFeature), destinationId = featureId(destinationFeature);
    if (sourceId !== null) setState(sourceId, { routeSource: false });
    if (destinationId !== null) setState(destinationId, { routeDestination: false });
    sourceFeature = null; destinationFeature = null; emitRoute();
  }
  // Re-apply flags after the buildings source is replaced (live data reload).
  function reapplyStates() {
    if (selectedId !== null) setState(selectedId, { selected: true });
    if (sourceFeature) setState(featureId(sourceFeature), { routeSource: true });
    if (destinationFeature) setState(featureId(destinationFeature), { routeDestination: true });
  }

  // One hit test per pointer event (a click fires exactly one selection).
  // Priority: a label under the pointer, then the nearest building wall (the
  // body layer returns the building the ray enters first), then a roof cap.
  function buildingAt(point) {
    const layers = BUILDING_LAYERS.filter((id) => map.getLayer(id));
    const hits = map.queryRenderedFeatures(point, { layers });
    const byLayer = (id) => hits.find((feature) => feature.layer?.id === id);
    return byLayer("building-labels-major") || byLayer("building-labels-minor") || byLayer("buildings-body") || byLayer("buildings-body-route-faded") || byLayer("buildings-roof") || byLayer("buildings-roof-route-faded") || null;
  }
  function move(event) {
    if (!isEnabled()) return;
    const feature = buildingAt(event.point), id = featureId(feature);
    if (!feature || id === null) { if (hoveredId !== null) leave(); return; }
    if (String(id) !== String(hoveredId)) {
      if (hoveredId !== null) setState(hoveredId, { hover: false });
      hoveredId = String(id);
      setState(hoveredId, { hover: true });
    }
    map.getCanvas().style.cursor = pickHandler ? "crosshair" : "pointer";
    onHover?.(canonical(feature), event.point);
  }
  function leave() { if (hoveredId !== null) setState(hoveredId, { hover: false }); hoveredId = null; map.getCanvas().style.cursor = pickHandler ? "crosshair" : ""; onHoverLeave?.(); }
  function click(event) {
    if (!isEnabled()) return;
    const feature = buildingAt(event.point);
    if (pickHandler) {
      if (!feature) return; // keep waiting for a building
      const handler = pickHandler;
      setPickHandler(null);
      handler(canonical(feature));
      return;
    }
    if (feature) { onHoverLeave?.(); selectFeature(feature); }
    else clearSelection();
  }
  map.on("mousemove", move);
  map.getCanvas().addEventListener("mouseleave", leave);
  map.on("click", click);
  return { selectFeature, clearSelection, setSourceFeature, setDestinationFeature, clearSourceFeature, clearDestinationFeature, swapRouteEndpoints, clearRouteSelection, setPickHandler, isPicking: () => pickHandler !== null, getRouteSelection: routeSnapshot, getSelectedId: () => selectedId, reapplyStates };
}
