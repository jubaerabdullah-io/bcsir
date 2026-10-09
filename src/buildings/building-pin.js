// Location pin on the selected building: the one chosen in the search box (a
// building, or the building of a laboratory or test) or clicked on the map. A
// chosen room or point has its own pin (indoor-controller.js); this one looks the same.
//
// It is a symbol layer, not an HTML marker like that one: it stands on top of the
// building's photo badge at roof height (symbol-height-offset, as the labels in
// bcsir-layers.js), which a marker cannot, and is scaled with the badge. Other
// labels never hide it. While the building's floor plan is open its shell and
// label are hidden, so the pin stands on the ground instead.
import { BUILDING_PIN_LAYER } from "../map/layer-ids.js";
import { labelAnchor } from "../utils/geo-utils.js";
import { BADGE_ICON_SIZE, BADGE_RADIUS } from "./building-labels.js";

const SOURCE = "building-pin";
const IMAGE = "bcsir-pin:building";
const PIXEL_RATIO = 2;
// The room pin's shape (32 x 42) at 3/4 of its size, in an image with room for the shadow.
const PATH = "M16 1.5C8 1.5 1.5 7.9 1.5 15.8 1.5 26.4 16 40.5 16 40.5S30.5 26.4 30.5 15.8C30.5 7.9 24 1.5 16 1.5Z";
const SCALE = 0.75;
const WIDTH = 30, HEIGHT = 38; // CSS px of the image
const TOP = 1; // CSS px above the pin's head
const BELOW_TIP = HEIGHT - (TOP + 40.5 * SCALE); // CSS px from the pin's point to the image's bottom
const ON_BADGE = 2; // CSS px the point reaches into the badge's white ring
const EMPTY = { type: "FeatureCollection", features: [] };

function drawPin() {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * PIXEL_RATIO;
  canvas.height = HEIGHT * PIXEL_RATIO;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }); // read back once (getImageData)
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  ctx.translate((WIDTH - 32 * SCALE) / 2, TOP);
  ctx.scale(SCALE, SCALE);
  const pin = new Path2D(PATH);
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.32)";
  ctx.shadowBlur = 3 * PIXEL_RATIO; // shadows ignore the transform
  ctx.shadowOffsetY = 1.5 * PIXEL_RATIO;
  ctx.fillStyle = "#ea4335";
  ctx.fill(pin);
  ctx.restore();
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.stroke(pin);
  ctx.beginPath(); ctx.arc(16, 15.5, 5.6, 0, Math.PI * 2); ctx.fillStyle = "#7f1d1d"; ctx.fill();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// The pin's point for a building (render copy): where its label stands, at the same
// height (the pin's point then touches the top of the badge); on the ground when `ground`.
export function buildingPinData(feature, { ground = false } = {}) {
  const point = feature ? labelAnchor(feature) : null;
  if (!point) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {
        render_id: feature.properties.render_id,
        ground,
        height: ground ? 0 : (Number(feature.properties.render_top_m) || 0) + 1
      },
      geometry: { type: "Point", coordinates: point }
    }]
  };
}

export function createBuildingPin(map) {
  let feature = null;
  let hiddenShells = new Set(); // render ids of the buildings whose floor plan is open

  if (!map.hasImage(IMAGE)) map.addImage(IMAGE, drawPin(), { pixelRatio: PIXEL_RATIO });
  map.addSource(SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: BUILDING_PIN_LAYER, type: "symbol", source: SOURCE,
    layout: {
      "icon-image": IMAGE,
      "icon-size": BADGE_ICON_SIZE,
      "icon-anchor": "bottom",
      // GeoJSON sources turn array properties into strings, so the offset is chosen here.
      "icon-offset": ["case", ["get", "ground"], ["literal", [0, BELOW_TIP]], ["literal", [0, BELOW_TIP - (BADGE_RADIUS - ON_BADGE)]]],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-height-anchor": "ground",
      "symbol-height-offset": ["get", "height"]
    }
  });

  const draw = () => {
    const ground = Boolean(feature) && hiddenShells.has(String(feature.properties?.render_id));
    map.getSource(SOURCE)?.setData(buildingPinData(feature, { ground }));
  };

  return {
    // The selected building (render copy), or null for none.
    set(next) {
      feature = next || null;
      draw();
    },
    setHiddenShells(ids) {
      hiddenShells = new Set((ids || []).map(String));
      if (feature) draw();
    }
  };
}
