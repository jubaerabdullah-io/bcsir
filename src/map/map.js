// MapLibre map and basemap configuration.
// From the reference project's src/map-redesign.js (worker URL fix, OSM context
// basemap, light, theme switching, zoom helper). The start view changed, and the
// style also holds a satellite imagery layer (see basemaps.js); the street
// layer "context-map" is unchanged.
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { INITIAL_VIEW } from "../core/config.js";
import { BASEMAP_SOURCES, basemapLayers } from "./basemaps.js";
import { activeOrg } from "../core/org.js";
import { viewMode } from "../core/view-mode.js";

maplibregl.setWorkerUrl(workerUrl);
const style = (basemap) => ({
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: { ...BASEMAP_SOURCES },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#edf2f3" } },
    ...basemapLayers(basemap)
  ]
});

export function createMap(container, { basemap } = {}) {
  const view = { ...INITIAL_VIEW, ...(activeOrg()?.view || {}) };
  // ?view=2d: the camera cannot tilt, so every camera move stays straight above the site.
  const flat = viewMode().flat;
  if (flat) { view.pitch = 0; view.bearing = 0; }
  const map = new maplibregl.Map({ container, style: style(basemap), center: view.center, zoom: view.zoom, pitch: view.pitch, bearing: view.bearing, canvasContextAttributes: { antialias: true }, attributionControl: true, maxPitch: flat ? 0 : 78, dragRotate: true, pitchWithRotate: true, touchPitch: true, hash: false });
  map.dragRotate.enable(); map.touchZoomRotate.enableRotation(); map.keyboard.enable();
  map.on("load", () => { try { map.setLight({ anchor: "map", color: "#ffffff", intensity: .42, position: [1.15, 205, 52] }); } catch (error) { console.info("Custom light unavailable", error); } });
  map.on("error", (event) => { const message = event?.error?.message || "Unknown map error"; if (!message.includes("tile")) console.warn("MapLibre:", message); });
  return map;
}

export function waitForMap(map) { if (map.loaded()) return Promise.resolve(); return new Promise((resolve) => map.once("load", resolve)); }
export function setMapTheme(map, theme) { if (!map.getLayer("context-map")) return; const dark = theme === "dark"; map.setPaintProperty("context-map", "raster-saturation", dark ? -1 : -.62); map.setPaintProperty("context-map", "raster-contrast", dark ? .2 : .04); map.setPaintProperty("context-map", "raster-brightness-min", dark ? .03 : .2); map.setPaintProperty("context-map", "raster-brightness-max", dark ? .3 : 1); map.setPaintProperty("background", "background-color", dark ? "#171a1c" : "#edf2f3"); }
export function zoomBy(map, delta) { map.easeTo({ zoom: map.getZoom() + delta, duration: 350 }); }
