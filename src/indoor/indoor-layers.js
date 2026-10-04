// MapLibre sources and layers of the open floor plans.
//
// An opened building is drawn without its shell, and the chosen floor lies at
// ground level: the floor slab, the corridors, the rooms (low coloured blocks) and
// the walls are fill-extrusions (so they hide and are hidden by the buildings
// around them correctly), room names and point icons are symbols, and the indoor
// part of a route is a line above them. One source holds every open floor; each
// feature carries `kind`, `building` and `level` (indoor-model.js).
import { INDOOR_STYLE } from "./indoor-model.js";
import { STYLE } from "../core/config.js";
import { INDOOR_LAYERS } from "../map/layer-ids.js";

const EMPTY = { type: "FeatureCollection", features: [] };
export const INDOOR_SOURCE = "indoor";
export const INDOOR_LABEL_SOURCE = "indoor-labels";
export const INDOOR_ROUTE_SOURCE = "indoor-route";
// The ids other modules also name are in map/layer-ids.js (the line and symbol
// layers stay above the 3D models: OVERLAY_LAYERS there).
const { units: INDOOR_UNIT_LAYER, pois: INDOOR_POI_LAYER, labels: INDOOR_LABEL_LAYER } = INDOOR_LAYERS;
// Layers a click or the pointer can pick a room or point from.
export const INDOOR_HIT_LAYERS = [INDOOR_POI_LAYER, INDOOR_LABEL_LAYER, INDOOR_UNIT_LAYER];

const kind = (name) => ["==", ["get", "kind"], name];
const state = (name) => ["boolean", ["feature-state", name], false];

// ---- Point icons ----------------------------------------------------------------------
// A round badge with a white pictogram, drawn once per class on a canvas.
const BADGE = { connector: "#2563eb", entrance: "#15803d", amenity: "#0f766e", safety: "#c2410c", other: "#64748b" };
const ICONS = {
  lift: { color: BADGE.connector, stroke: "M7.5 4.5h9v15h-9z M10 10.5l2-2.4 2 2.4 M10 13.5l2 2.4 2-2.4" },
  stairs: { color: BADGE.connector, stroke: "M5 18.5h3.5V15H12v-3.5h3.5V8H19" },
  escalator: { color: BADGE.connector, stroke: "M4.5 18h3.8l7.4-9.5h3.8 M9 6.5a1.4 1.4 0 1 0 .01 0" },
  ramp: { color: BADGE.connector, stroke: "M4.5 17.5h15V9z" },
  entrance: { color: BADGE.entrance, stroke: "M13.5 4.5h5v15h-5 M5 12h9 M10.8 8.6 14.2 12l-3.4 3.4" },
  toilet: { color: BADGE.amenity, text: "WC" },
  info: { color: BADGE.amenity, text: "i" },
  food: { color: BADGE.amenity, stroke: "M7.5 4.5v6.2a1.8 1.8 0 0 0 1.8 1.8v7 M5.8 4.5v4.3 M9.3 4.5v4.3 M16.5 4.5c-1.6 1.4-2.4 3.4-2.4 6.2h2.4v8.8" },
  prayer: { color: BADGE.amenity, fill: "M14.8 4.6a7.6 7.6 0 1 0 4.6 12.9 6.6 6.6 0 0 1-4.6-12.9Z" },
  atm: { color: BADGE.amenity, text: "৳" },
  water: { color: BADGE.amenity, fill: "M12 4.2c2.8 3.6 4.7 6 4.7 8.5a4.7 4.7 0 0 1-9.4 0c0-2.5 1.9-4.9 4.7-8.5Z" },
  "first-aid": { color: "#dc2626", stroke: "M12 6v12 M6 12h12", width: 3 },
  fire: { color: BADGE.safety, fill: "M12 3.8c.9 2.8 3.8 4.2 3.8 8a3.8 3.8 0 0 1-7.6 0c0-1.4.5-2.4 1.4-3.3 0 1.4.8 2.1 1.4 2.1.9-2.3 0-4.2 1-6.8Z" },
  parking: { color: BADGE.other, text: "P" },
  poi: { color: BADGE.other, fill: "M12 8.2a3.8 3.8 0 1 0 .01 0Z" }
};
const ICON_PX = 30; // CSS pixels of a badge, including its soft shadow
const PIXEL_RATIO = 2;
export const iconId = (type) => `indoor-icon:${ICONS[type] ? type : "poi"}`;

function drawIcon({ color, stroke, fill, text, width = 1.9 }) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ICON_PX * PIXEL_RATIO;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  const c = ICON_PX / 2, r = 11.5;
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.3)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;
  ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.arc(c, c, r - 1.6, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  // Pictograms are drawn on a 24-unit grid, scaled to 17 px in the badge.
  const scale = 17 / 24;
  ctx.translate(c - 12 * scale, c - 12 * scale);
  ctx.scale(scale, scale);
  if (stroke) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(new Path2D(stroke)); }
  if (fill) { ctx.fillStyle = "#ffffff"; ctx.fill(new Path2D(fill)); }
  if (text) {
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${text.length > 1 ? 11 : 15}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 12, 12.6);
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function addIndoorLayers(map, { beforeId } = {}) {
  for (const [type, spec] of Object.entries(ICONS)) {
    if (!map.hasImage(iconId(type))) map.addImage(iconId(type), drawIcon(spec), { pixelRatio: PIXEL_RATIO });
  }
  map.addSource(INDOOR_SOURCE, { type: "geojson", data: EMPTY, promoteId: "uid" });
  map.addSource(INDOOR_LABEL_SOURCE, { type: "geojson", data: EMPTY, promoteId: "uid" });
  map.addSource(INDOOR_ROUTE_SOURCE, { type: "geojson", data: EMPTY });

  const extrusion = (id, filter, paint) => map.addLayer({ id, type: "fill-extrusion", source: INDOOR_SOURCE, filter, paint: { "fill-extrusion-base": 0, "fill-extrusion-opacity": 1, "fill-extrusion-vertical-gradient": false, ...paint } }, beforeId);
  extrusion("indoor-floor", kind("floor"), { "fill-extrusion-color": INDOOR_STYLE.floor, "fill-extrusion-height": 0.1 });
  extrusion("indoor-corridor", kind("corridor"), { "fill-extrusion-color": INDOOR_STYLE.corridor, "fill-extrusion-height": 0.14 });
  // Route endpoints take precedence, then the selected and the hovered room.
  extrusion(INDOOR_UNIT_LAYER, kind("unit"), {
    "fill-extrusion-color": ["case",
      state("routeSource"), INDOOR_STYLE.routeSource,
      state("routeDestination"), INDOOR_STYLE.routeDestination,
      state("selected"), INDOOR_STYLE.selected,
      state("hover"), INDOOR_STYLE.hover,
      ["get", "color"]],
    "fill-extrusion-height": ["get", "height"]
  });
  extrusion("indoor-walls", kind("wall"), { "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": ["get", "height"], "fill-extrusion-vertical-gradient": true });

  // Indoor part of the route: the legs on the shown floors, and (dashed) the legs
  // on the other floors of an open building.
  const shown = ["==", ["get", "shown"], true];
  map.addLayer({ id: INDOOR_LAYERS.routeOther, type: "line", source: INDOOR_ROUTE_SOURCE, filter: ["!", shown], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": STYLE.route, "line-width": 2.5, "line-opacity": 0.35, "line-dasharray": [1.2, 1.8] } });
  map.addLayer({ id: INDOOR_LAYERS.routeCasing, type: "line", source: INDOOR_ROUTE_SOURCE, filter: shown, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": STYLE.routeCasing, "line-width": ["interpolate", ["linear"], ["zoom"], 16, 5, 19, 9, 22, 14], "line-opacity": 0.95 } });
  map.addLayer({ id: INDOOR_LAYERS.routeLine, type: "line", source: INDOOR_ROUTE_SOURCE, filter: shown, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": STYLE.route, "line-width": ["interpolate", ["linear"], ["zoom"], 16, 3, 19, 5, 22, 9] } });

  map.addLayer({
    id: INDOOR_LABEL_LAYER, type: "symbol", source: INDOOR_LABEL_SOURCE, filter: kind("unit-label"), minzoom: 17.5,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Open Sans Semibold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 17.5, 10, 20, 12.5, 22, 14],
      "text-max-width": 7,
      "text-line-height": 1.15,
      "text-padding": 3,
      "symbol-height-anchor": "ground",
      "symbol-height-offset": 0.6
    },
    paint: { "text-color": "#27313d", "text-halo-color": "rgba(255,255,255,0.92)", "text-halo-width": 1.4 }
  });
  map.addLayer({
    id: INDOOR_POI_LAYER, type: "symbol", source: INDOOR_LABEL_SOURCE, filter: kind("poi"), minzoom: 16.5,
    layout: {
      "icon-image": ["concat", "indoor-icon:", ["get", "icon"]],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 16.5, 0.7, 19, 1],
      "icon-allow-overlap": true,
      "icon-ignore-placement": false,
      "text-field": ["step", ["zoom"], "", 19.5, ["get", "name"]],
      "text-font": ["Open Sans Semibold"],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 1.1],
      "text-optional": true,
      "symbol-height-anchor": "ground",
      "symbol-height-offset": 0.8,
      "symbol-sort-key": ["match", ["get", "class"], ["lift", "stairs", "escalator", "ramp", "entrance"], 0, 1]
    },
    paint: { "text-color": "#1f2937", "text-halo-color": "rgba(255,255,255,0.95)", "text-halo-width": 1.4 }
  });
}

export function setIndoorData(map, render, labels) {
  map.getSource(INDOOR_SOURCE)?.setData(render || EMPTY);
  map.getSource(INDOOR_LABEL_SOURCE)?.setData(labels || EMPTY);
}

export function setIndoorRoute(map, collection) {
  map.getSource(INDOOR_ROUTE_SOURCE)?.setData(collection || EMPTY);
}
