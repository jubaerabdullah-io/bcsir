// PMTiles vector tile support for production builds.
//
// In development the map uses GeoJSON sources (fast edit–reload cycle, small
// data). In production the CI generates a per-organisation .pmtiles archive
// from the pre-processed GeoJSON (scripts/build-tiles.mjs + tippecanoe). This
// module registers the pmtiles:// protocol with MapLibre and exposes helpers
// that bcsir-layers.js uses to add vector sources instead of GeoJSON ones.
//
// The tile layers mirror the GeoJSON source names:
//   campus-ground  — area, boundary, roads, pathways, internal (render_part filter)
//   buildings      — building polygons with render_* properties
//   building-seams — roof seam strips
//   building-corners — corner column squares
//   garden         — garden polygons
//   building-labels — label points
import * as pmtiles from "pmtiles";
import { publicAssetUrl } from "./paths.js";
import { orgId } from "./org.js";

let protocol = null;
let tilesAvailable = null; // null = not checked, true/false after probe

// Register the pmtiles:// protocol once. Safe to call many times.
export function registerProtocol(maplibregl) {
  if (protocol) return;
  protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
}

// The URL of the organisation's .pmtiles archive.
function tilesUrl() {
  const id = orgId();
  return publicAssetUrl(`data/${id}/tiles.pmtiles`);
}

// Probe whether the .pmtiles file exists.
// Never use tiles in development (Vite's SPA fallback returns 200 + text/html
// for non-existent paths, which would falsely enable vector tile mode).
export async function hasTiles() {
  if (tilesAvailable !== null) return tilesAvailable;
  if (import.meta.env.DEV) { tilesAvailable = false; return false; }
  try {
    const response = await fetch(tilesUrl(), { method: "HEAD" });
    const type = response.headers.get("content-type") || "";
    tilesAvailable = response.ok && !type.startsWith("text/html");
  } catch {
    tilesAvailable = false;
  }
  return tilesAvailable;
}

// A pmtiles:// URL that MapLibre resolves through the registered protocol.
function pmtilesSource() {
  return `pmtiles://${tilesUrl()}`;
}

// Vector source definition for one named layer inside the .pmtiles archive.
// MapLibre's vector source needs the tile URL, and layers filter by source-layer.
export function vectorSource() {
  return {
    type: "vector",
    url: pmtilesSource()
  };
}

// The source-layer names used in the .pmtiles archive (must match tippecanoe -L names).
export const SOURCE_LAYERS = {
  campusGround: "campus-ground",
  buildings: "buildings",
  buildingSeams: "building-seams",
  buildingCorners: "building-corners",
  garden: "garden",
  buildingLabels: "building-labels"
};
