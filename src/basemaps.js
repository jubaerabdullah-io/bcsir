// Basemaps: the existing OpenStreetMap street map and a satellite imagery layer.
//
// Both raster sources live in the same MapLibre style. Switching basemaps
// changes which raster layer is visible; the style is never reloaded. While
// satellite is active, main.js hides the drawn campus layers
// (SATELLITE_HIDDEN_GROUPS in bcsir-layers.js) so only the imagery shows.
//
// MapLibre's attribution control lists the attribution of the sources used by
// visible layers, so the active basemap's credits are always shown.
// Pure module (no MapLibre import) so it can be tested with node --test.

export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
export const ESRI_ATTRIBUTION = 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> | Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export const BASEMAP_SOURCES = {
  // Unchanged street map source (only the attribution now links to the licence).
  osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: OSM_ATTRIBUTION },
  // Esri World Imagery. Use is subject to Esri's terms of use and attribution rules.
  "esri-imagery": { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19, attribution: ESRI_ATTRIBUTION }
};

export const BASEMAPS = [
  { id: "street", label: "Street", layer: "context-map", source: "osm" },
  { id: "satellite", label: "Satellite", layer: "satellite-map", source: "esri-imagery" }
];

export const DEFAULT_BASEMAP = "street";

// The existing street layer (desaturated OSM context map) and the satellite layer.
export function basemapLayers(active = DEFAULT_BASEMAP) {
  return [
    { id: "context-map", type: "raster", source: "osm", minzoom: 0, maxzoom: 22, layout: { visibility: active === "street" ? "visible" : "none" }, paint: { "raster-opacity": 0.5, "raster-saturation": -0.62, "raster-contrast": 0.04, "raster-brightness-min": 0.2, "raster-brightness-max": 1 } },
    { id: "satellite-map", type: "raster", source: "esri-imagery", minzoom: 0, maxzoom: 22, layout: { visibility: active === "satellite" ? "visible" : "none" }, paint: { "raster-opacity": 1, "raster-fade-duration": 200 } }
  ];
}

export const basemapById = (id) => BASEMAPS.find((basemap) => basemap.id === id) || null;

// Layer visibility for the active basemap. `enabled` is the "Basemap" switch in
// the layer list: when it is off, neither raster layer is drawn.
export function basemapVisibility(active, enabled = true) {
  return Object.fromEntries(BASEMAPS.map((basemap) => [basemap.layer, enabled && basemap.id === active ? "visible" : "none"]));
}

// Tile URL of the campus area, used as the thumbnail of each basemap choice.
export function thumbnailUrl(basemapId, [lon, lat], zoom = 16) {
  const n = 2 ** zoom;
  const x = Math.floor((lon + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  const template = BASEMAP_SOURCES[basemapById(basemapId)?.source]?.tiles?.[0];
  return template ? template.replace("{z}", zoom).replace("{x}", x).replace("{y}", y) : "";
}
