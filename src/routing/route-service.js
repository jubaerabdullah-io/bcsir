// Route calculation for the 3D map, using the ORIGINAL BCSIR routing code.
//
// buildGraph(), dijkstra() and findConnectedComponents() come from
// connection_check.js, unmodified (served by Vite as "virtual:bcsir-routing").
// The road network is ConnectedRoads/v0/r2.json, exactly as the original
// script uses it. The graph, its edge weights and its connectivity are therefore
// identical to the original implementation.
//
// What this file adds (and does NOT change in the algorithm):
// 1. Endpoint selection. The original dijkstra() needs start/end keys that are
//    graph nodes ("lon,lat" rounded to 6 decimals). The original script reads
//    them from pois.json, which is not in the repository. Here a building's
//    entrance_coords (or its footprint centroid when no entrance is recorded)
//    is snapped to the nearest graph node, and the snap distance is reported.
// 2. Display helpers: the path's node keys are mapped back to the full-precision
//    r2.json vertex they came from, and a metric length is computed for display.

import { buildGraph, dijkstra, findConnectedComponents, isGraphConnected } from "virtual:bcsir-routing";
import { distanceMeters, polygonCentroid } from "../geo-utils.js";

const keyToCoordinates = (key) => key.split(",").map(Number);

// Mirrors the node-key construction inside the original buildGraph() so each key
// can be drawn at the unrounded r2.json coordinate it was created from.
function originalCoordinatesByKey(network) {
  const lookup = new Map();
  network.features.forEach((feature) => {
    if (feature.geometry && feature.geometry.type === "MultiLineString") {
      feature.geometry.coordinates[0].forEach((coordinate) => {
        const key = coordinate.map((value) => value.toFixed(6)).join(",");
        if (!lookup.has(key)) lookup.set(key, [coordinate[0], coordinate[1]]);
      });
    }
  });
  return lookup;
}

export function createRouteService(network) {
  const graph = buildGraph(network); // original
  const components = findConnectedComponents(graph); // original
  const connected = isGraphConnected(graph); // original
  const componentOf = new Map();
  components.forEach((component, index) => component.forEach((key) => componentOf.set(key, index)));
  const precise = originalCoordinatesByKey(network);
  const nodes = [...graph.keys()].map((key) => ({ key, coordinates: keyToCoordinates(key) }));
  let edgeCount = 0;
  graph.forEach((neighbors) => { edgeCount += neighbors.size; });

  function nearestNode(point) {
    let best = null;
    for (const node of nodes) {
      const distance = distanceMeters(point, node.coordinates);
      if (!best || distance < best.distanceM) best = { node, distanceM: distance };
    }
    return best;
  }

  function endpointFor(feature) {
    const p = feature?.properties || {};
    const hasEntrance = Number.isFinite(p.entrance_lon) && Number.isFinite(p.entrance_lat);
    const point = hasEntrance ? [p.entrance_lon, p.entrance_lat] : polygonCentroid(feature);
    if (!point) return null;
    const nearest = nearestNode(point);
    if (!nearest) return null;
    return {
      feature,
      point,
      kind: hasEntrance ? "entrance" : "centroid",
      nodeKey: nearest.node.key,
      nodeCoordinates: precise.get(nearest.node.key) || nearest.node.coordinates,
      snapDistanceM: nearest.distanceM,
      component: componentOf.get(nearest.node.key)
    };
  }

  function lengthOf(coordinates) {
    let total = 0;
    for (let i = 1; i < coordinates.length; i += 1) total += distanceMeters(coordinates[i - 1], coordinates[i]);
    return total;
  }

  function route(sourceFeature, destinationFeature) {
    const source = endpointFor(sourceFeature);
    const destination = endpointFor(destinationFeature);
    if (!source || !destination) return { ok: false, reason: "no-endpoint", source, destination };
    if (source.nodeKey === destination.nodeKey) {
      return { ok: true, path: [source.nodeKey], coordinates: [source.nodeCoordinates], networkDistanceM: 0, source, destination };
    }
    const started = performance.now();
    const path = dijkstra(graph, source.nodeKey, destination.nodeKey); // original
    const elapsedMs = performance.now() - started;
    if (!path) return { ok: false, reason: "no-path", source, destination, elapsedMs };
    const coordinates = path.map((key) => precise.get(key) || keyToCoordinates(key));
    return { ok: true, path, coordinates, networkDistanceM: lengthOf(coordinates), source, destination, elapsedMs };
  }

  return {
    graph,
    components,
    route,
    endpointFor,
    stats: { nodes: graph.size, directedEdges: edgeCount, components: components.map((c) => c.length), connected }
  };
}

// GeoJSON for the map: the network path plus dashed "access" legs from the
// entrance/centroid to the snapped node (these are not part of the network).
export function routeToGeoJSON(result) {
  if (!result?.source || !result?.destination) return { type: "FeatureCollection", features: [] };
  const features = [];
  if (result.ok && result.coordinates.length > 1) {
    features.push({ type: "Feature", properties: { kind: "network" }, geometry: { type: "LineString", coordinates: result.coordinates } });
  }
  for (const endpoint of [result.source, result.destination]) {
    if (endpoint.snapDistanceM > 0.05) {
      features.push({ type: "Feature", properties: { kind: "access" }, geometry: { type: "LineString", coordinates: [endpoint.point, endpoint.nodeCoordinates] } });
    }
  }
  return { type: "FeatureCollection", features };
}
