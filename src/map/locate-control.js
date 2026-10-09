// "My location" button of the right-hand controls (above the zoom buttons): the
// visitor's own position on the map, as in Google Maps.
//
// A tap asks the browser for the position (navigator.geolocation, high accuracy;
// the browser asks the visitor first). It is marked with the blue dot of live
// navigation and a circle of the GPS accuracy, and brought into view. The dot then
// moves with the visitor and the map follows it, until the map is moved away; a tap
// brings it back. A tap while it is followed (or looked for) turns it off, and the
// GPS with it.
// State of the button (data-state): "off" | "locating" (no position yet) |
// "following" (in the middle of the view) | "shown" (the map was moved away).
import * as maplibregl from "maplibre-gl";
import { STYLE } from "../core/config.js";
import { GARDEN_LAYER } from "./layer-ids.js";
import { formatDistance } from "../routing/route-summary.js";
import { distanceMeters } from "../utils/geo-utils.js";
import { circlePolygon } from "../utils/local-frame.js";

const LOCATE_ZOOM = 18; // near enough to tell the buildings apart
const FLY_MAX_MS = 3000; // a longer flight (a position far away) is a jump
const FOLLOW_EASE_MS = 600;
const MOVED_AWAY_PX = 10; // the view was moved away once its centre has gone this far
const CAMPUS_RANGE_M = 1500; // farther from the campus, the distance is told
const OWN_MOVE = { locate: true }; // event data of the camera moves made here
const ACCURACY_SOURCE = "locate-accuracy";
const NO_FEATURES = { type: "FeatureCollection", features: [] };
const LABELS = { off: "Show my location", locating: "Finding your location…", following: "Hide my location", shown: "Centre the map on my location" };

// flyOffset() is where the position is brought to, in pixels from the centre of the
// map (fit-padding.js): the middle of what the panels leave free.
export function createLocateControl(map, { button, campusCenter = null, flyOffset = () => [0, 0], onMessage } = {}) {
  if (!map || !button) return { stop: () => {}, state: () => "off" };

  const element = document.createElement("div");
  element.className = "nav-user";
  element.innerHTML = '<span class="nav-user-dot"></span>';
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", "Your position");
  const marker = new maplibregl.Marker({ element, rotationAlignment: "map", pitchAlignment: "map" });

  let state = "off";
  let watchId = null;
  let fix = null; // { point: [lon, lat], accuracy (metres) } of the last position
  let viewCentre = null; // the centre of the view when the position was last brought into it

  function setState(next) {
    state = next;
    button.dataset.state = next;
    button.setAttribute("aria-pressed", String(next !== "off"));
    button.setAttribute("aria-label", LABELS[next]);
    button.title = LABELS[next];
  }

  function showAccuracy() {
    if (!map.getSource(ACCURACY_SOURCE)) {
      if (!fix) return;
      map.addSource(ACCURACY_SOURCE, { type: "geojson", data: NO_FEATURES });
      map.addLayer({ id: `${ACCURACY_SOURCE}-fill`, type: "fill", source: ACCURACY_SOURCE, paint: { "fill-color": STYLE.pinSource, "fill-opacity": 0.12, "fill-outline-color": "rgba(30, 136, 229, 0.45)" } }, map.getLayer(GARDEN_LAYER) ? GARDEN_LAYER : undefined);
    }
    map.getSource(ACCURACY_SOURCE).setData(fix && fix.accuracy > 3 ? { type: "FeatureCollection", features: [circlePolygon(fix.point, fix.accuracy)] } : NO_FEATURES);
  }

  // How far (pixels) a position is from the point of the view `offset` from its middle.
  function pixelsFrom(point, [dx, dy] = [0, 0]) {
    const canvas = map.getCanvas();
    const { x, y } = map.project(point);
    return Math.hypot(x - canvas.clientWidth / 2 - dx, y - canvas.clientHeight / 2 - dy);
  }

  // Brings the position into the middle of the free part of the view and follows it.
  // `fly` (a tap, the first position) also zooms in to it, but no nearer than shows the
  // whole accuracy circle: a position known to a kilometre is not shown as a spot
  // between two buildings. The camera moves first: the animation it ends was made
  // before the position was followed.
  function centre(fly = false) {
    const offset = flyOffset();
    if (fly) {
      const bounds = maplibregl.LngLatBounds.fromLngLat(new maplibregl.LngLat(fix.point[0], fix.point[1]), Math.max(fix.accuracy || 0, 1));
      const widest = map.cameraForBounds(bounds, { padding: 40 })?.zoom ?? Infinity;
      map.flyTo({ center: fix.point, offset, zoom: Math.min(Math.max(map.getZoom(), LOCATE_ZOOM), widest), maxDuration: FLY_MAX_MS, essential: true }, OWN_MOVE);
    } else if (pixelsFrom(fix.point, offset) >= 1) {
      map.easeTo({ center: fix.point, offset, duration: FOLLOW_EASE_MS, essential: true }, OWN_MOVE);
    }
    setState("following");
  }

  function onFix({ coords }) {
    const first = !fix;
    fix = { point: [coords.longitude, coords.latitude], accuracy: coords.accuracy };
    marker.setLngLat(fix.point);
    if (first) marker.addTo(map);
    showAccuracy();
    if (first) {
      centre(true);
      const away = campusCenter ? distanceMeters(fix.point, campusCenter) : 0;
      if (away > CAMPUS_RANGE_M) onMessage?.(`You are ${formatDistance(away)} from the campus`);
    } else if (state === "following" && !map.isMoving()) centre();
  }

  // Without a position the search ends. With one, the last position stays (the GPS may
  // come back), unless the permission was taken away.
  function onError(error) {
    const denied = error?.code === 1;
    if (fix && !denied) return;
    stop();
    onMessage?.(denied ? "Location is blocked for this site. Allow it in the browser's site settings." : "Your location could not be found");
  }

  function start() {
    if (!window.isSecureContext) { onMessage?.("Your location needs an https:// address"); return; }
    if (!("geolocation" in navigator)) { onMessage?.("Location is not available on this device"); return; }
    setState("locating");
    watchId = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }

  function stop() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    fix = null;
    viewCentre = null;
    marker.remove();
    showAccuracy();
    setState("off");
  }

  button.addEventListener("click", () => {
    if (state === "off") start();
    else if (state === "shown") centre(true);
    else stop();
  });

  // After a camera move made here: where the view now is. After any other one: a view
  // moved away (by hand, or to a building or a route) no longer follows the position;
  // a zoom or a turn about its middle does, and the position goes back to its place.
  map.on("moveend", (event) => {
    if (event.locate) { viewCentre = map.getCenter(); return; }
    if (state !== "following" || !viewCentre) return;
    if (pixelsFrom(viewCentre) > MOVED_AWAY_PX) setState("shown"); else centre();
  });

  return {
    // Live navigation and walk mode show the position themselves.
    stop,
    state: () => state
  };
}
