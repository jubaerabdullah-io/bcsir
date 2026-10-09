// Live route guidance (Google Maps style) for the calculated walking route.
//
// Start: follows the phone's GPS position along the route. The map turns with
// the phone's compass (walking direction when there is no usable compass),
// with the user's position in the lower part of the screen. A banner shows the
// next turn and its distance, the sheet the remaining distance and time.
// The route follows the walker, as in Google Maps: whenever he leaves it (a
// wrong turn, another path) a new route is found from where he now is, with the
// original routing algorithm, and drawn in place of the old one. A position that
// is exact (3D mode, a position set on the map) re-routes within a second or two
// of leaving the line; a GPS position, which jumps, a little later and farther
// from it. Inside a building the route to the room is found again the same way.
// 3D mode: the same session in first-person walk mode (walk/walk-mode.js), with the
// route and destination kept. It follows GPS and the compass from the start: the
// walker stands where the visitor stands (while the first position is awaited the
// walk starts at the beginning of the route and jumps to the visitor as soon as it
// arrives; where GPS is refused, missing or away from the campus it stays on the
// route and says so). "Follow GPS" turns the following off and on again, and the
// on-screen / keyboard controls take over whenever it is off.
//
// GPS does not tell floors or rooms, so on the map guidance ends at the building
// (its recorded entrance, else the edge of its footprint). In 3D mode a route to a
// room of a building with floor plans goes on inside: in through the entrance,
// along the corridors to the lift or the stairs, a floor change (the floor
// selector, or Page Up / Page Down), and on to the room, leg by leg
// (getIndoorRoute(): the indoor legs of indoor/trip.js; getIndoorPosition(): the
// building and floor the walker is on, walk/walk-indoor.js). Where GPS is missing,
// refused, weak or far from the campus, the position can be set by tapping the map
// ("Set position"), or walked in 3D mode. Esc ends navigation on the map (in 3D
// mode it first leaves 3D mode).
//
// Rendering: the camera and the position marker are animated in one
// requestAnimationFrame loop that runs only while something moves (a new GPS
// position is eased in over ~1 s; the heading is smoothed); it stops when the
// position and heading are settled. DOM text is only written when it changes.
import * as maplibregl from "maplibre-gl";
import { STYLE } from "../core/config.js";
import { GARDEN_LAYER } from "../map/layer-ids.js";
import { formatDistance, walkingMinutes } from "../routing/route-summary.js";
import { routePathCoordinates } from "../routing/route-service.js";
import { createCompass } from "./compass.js";
import { angleDelta, bearingOf, circlePolygon, createLocalFrame, distance, geometryPolygons, insideRings, normalizeDegrees } from "../utils/local-frame.js";
import { bearingAt, compassWord, createRouteModel, formatGuidanceDistance, guidance, locate, maneuverText, pointAt } from "./route-progress.js";
import { indoorStages, nextIndoorStage, remainingAfter } from "./indoor-guidance.js";

const FOLLOW_ZOOM = 19;
const FOLLOW_PITCH = 60;
const FOLLOW_TOP_PADDING = 0.4; // share of the screen height above the position
const INTRO_MS = 900;
const POSITION_EASE_MS = 900;
const HEADING_SMOOTHING_S = 0.18;
const HEADING_DEADBAND_DEG = 1.2;
// Leaving the route, by how the position is known: off it once `offM` away for
// `confirmMs`, a new route after `rerouteMs` when still `rerouteM` away, and not
// more often than every `intervalMs`.
const OFF_ROUTE = {
  gps: { offM: 12, confirmMs: 2000, rerouteMs: 4000, rerouteM: 12, intervalMs: 6000 },
  exact: { offM: 6, confirmMs: 600, rerouteMs: 1200, rerouteM: 6, intervalMs: 2500 }
};
const offRouteRule = (source) => (source === "gps" ? OFF_ROUTE.gps : OFF_ROUTE.exact);
const INDOOR_OFF_ROUTE_M = 3; // inside: this far from the line of the corridor (a wrong turn, a room)
const INDOOR_OFF_CONNECTOR_M = 5; // ... or from the lift or stairs to be taken
const INDOOR_REROUTE_INTERVAL_MS = 1200;
const ARRIVAL_M = 6;
const WEAK_GPS_M = 30;
const UNUSABLE_GPS_M = 80;
const CAMPUS_RANGE_M = 1500;
const NO_FIX_HINT_MS = 12000;
const ASSIST_DEG_PER_S = 75;

const ICON_PATHS = {
  straight: "M12 20V5M12 5l-5 5M12 5l5 5",
  left: "M17 20v-7a4 4 0 0 0-4-4H6M6 9l4-4M6 9l4 4",
  right: "M7 20v-7a4 4 0 0 1 4-4h7M18 9l-4-4M18 9l-4 4",
  "slight-left": "M15 20v-6L8 7M8 7v5M8 7h5",
  "slight-right": "M9 20v-6l7-7M16 7v5M16 7h-5",
  "sharp-left": "M16 5v9l-9 6M7 20v-5M7 20h5",
  "sharp-right": "M8 5v9l9 6M17 20v-5M17 20h-5",
  uturn: "M8 20V9a4 4 0 0 1 8 0v6M16 15l-3-3M16 15l3-3",
  arrive: "M12 21s6-5.6 6-11a6 6 0 0 0-12 0c0 5.4 6 11 6 11Zm0-8.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z",
  depart: "M12 20V5M12 5l-5 5M12 5l5 5",
  enter: "M13.5 4.5h5v15h-5 M5 12h9 M10.8 8.6 14.2 12l-3.4 3.4",
  lift: "M7.5 4.5h9v15h-9z M10 10.5l2-2.4 2 2.4 M10 13.5l2 2.4 2-2.4",
  stairs: "M5 18.5h3.5V15H12v-3.5h3.5V8H19"
};

function iconSvg(type, rotation = 0) {
  const path = ICON_PATHS[type] || ICON_PATHS.straight;
  const filled = type === "arrive";
  return `<svg viewBox="0 0 24 24" style="transform: rotate(${Math.round(rotation)}deg)" aria-hidden="true"><path d="${path}" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;
}

// The part of the route outside its endpoint buildings: without an indoor map
// the walk starts where the route leaves the start building and ends where it
// reaches the destination building.
function clipOutside(points, feature, fromStart) {
  const polygons = geometryPolygons(feature?.geometry);
  if (!polygons.length || points.length < 2) return points;
  const inside = (p) => polygons.some((rings) => insideRings(p, rings));
  const list = fromStart ? points : [...points].reverse();
  if (!inside(list[0])) return points;
  for (let i = 1; i < list.length; i += 1) {
    if (inside(list[i])) continue;
    let a = list[i - 1], b = list[i];
    for (let k = 0; k < 24; k += 1) {
      const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (inside(middle)) a = middle; else b = middle;
    }
    const clipped = [b, ...list.slice(i)];
    return clipped.length > 1 ? (fromStart ? clipped : clipped.reverse()) : points;
  }
  return points;
}

// getIndoorRoute() -> { building, legs, name, levelName(id) } | null: the route inside
//   the destination building (to a room), followed in 3D mode after the outdoor part
// getIndoorPosition() -> { building, level } | null: where the walker is inside
// rerouteIndoor(position, where) -> Promise<legs | null>: the route inside from where
//   the walker now is to the same room, when he has left the one he was on
export function createLiveNavigation({ map, walk, getRoute, reroute, rerouteIndoor, collision, campusCenter, cameraController, getIndoorRoute, getIndoorPosition, onSession, onToast } = {}) {
  const $ = (selector) => document.querySelector(selector);
  const ui = {
    banner: $("#nav-banner"), icon: $("#nav-maneuver"), distance: $("#nav-distance"), text: $("#nav-text"), then: $("#nav-then"), line: $("#nav-line"),
    alert: $("#nav-alert"), sheet: $("#nav-sheet"), eta: $("#nav-eta"), remaining: $("#nav-remaining"), status: $("#nav-status"),
    recenter: $("#nav-recenter"), position: $("#nav-position"), gps: $("#nav-gps"), view: $("#nav-view"), end: $("#nav-end"), close: $("#nav-close"), walkGps: $("#walk-gps")
  };
  const stub = { start: () => false, end: () => {}, isActive: () => false, isPickingPosition: () => false, setRoute: () => {}, onWalkPose: () => {}, onWalkState: () => {}, onManualInput: () => {}, steer: () => 0, state: () => null };
  if (!map || !walk || !ui.banner || !ui.sheet) return stub;

  const markerElement = document.createElement("div");
  markerElement.className = "nav-user";
  markerElement.innerHTML = '<span class="nav-user-cone"></span><span class="nav-user-dot"></span>';
  markerElement.setAttribute("role", "img");
  markerElement.setAttribute("aria-label", "Your position");
  const marker = new maplibregl.Marker({ element: markerElement, rotationAlignment: "map", pitchAlignment: "map" });

  const compass = createCompass({ onReading: () => { if (session) updateHeadingTarget(); }, onStatus: () => render() });
  const gps = { watchId: null, status: "off", fix: null, noFixTimer: 0 };
  const anim = { frame: 0, last: 0, from: null, to: null, start: 0, center: null, heading: null, target: null };
  const texts = new Map();
  let session = null;
  let markerShown = false;
  let introTimer = 0;
  let routeCheckTimer = 0;

  const setText = (element, value) => {
    if (!element || texts.get(element) === value) return;
    texts.set(element, value);
    element.textContent = value;
  };
  const setHidden = (element, hidden) => { if (element && element.hidden !== hidden) element.hidden = hidden; };
  const destinationName = () => session?.destinationName || "your destination";

  // ---- Route ------------------------------------------------------------------
  function buildModel(result) {
    const full = routePathCoordinates(result);
    if (!full) return null;
    const path = clipOutside(clipOutside(full, result.source?.feature, true), result.destination?.feature, false);
    return createRouteModel(path);
  }

  function useRoute(result) {
    const model = buildModel(result);
    if (!model) return false;
    session.result = result;
    session.model = model;
    session.destinationName = String(result.destination?.feature?.properties?.name_en || result.destination?.feature?.properties?.render_label || "").trim();
    session.destinationId = String(result.destination?.feature?.properties?.render_id ?? "");
    session.progress = session.position ? locate(model, session.position) : null;
    session.offRouteSince = 0;
    session.offRoute = false;
    session.arrived = false;
    session.indoor = null;
    return true;
  }

  // ---- Inside the destination building (3D mode) -------------------------------
  // { stages, index, name, levelName }: the stage he is at (indoor-guidance.js).
  const indoorStage = () => session?.indoor?.stages[session.indoor.index] || null;
  function beginIndoor() {
    const route = getIndoorRoute?.();
    const stages = route ? indoorStages(route.legs) : [];
    if (!stages.length || stages[0].type !== "walk") return false;
    session.indoor = { stages, index: 0, name: route.name || destinationName(), levelName: route.levelName || ((id) => id) };
    session.model = stages[0].model;
    session.progress = session.position ? locate(session.model, session.position) : null;
    session.offRoute = false;
    session.offRouteSince = 0;
    onToast?.(`${destinationName()}: walk in through the entrance to ${session.indoor.name}`);
    return true;
  }
  // After a move inside: on to the next stage when this one is done.
  function followIndoor() {
    const { indoor } = session;
    const next = nextIndoorStage(indoor.stages, indoor.index, getIndoorPosition?.() || null, session.position);
    if (next === indoor.index) return;
    if (next >= indoor.stages.length) {
      indoor.index = indoor.stages.length - 1;
      session.arrived = true;
      session.arrivalNote = "";
      onToast?.(`You have arrived at ${indoor.name}`);
      return;
    }
    indoor.index = next;
    const stage = indoorStage();
    if (stage.type === "walk") {
      session.model = stage.model;
      session.progress = locate(stage.model, session.position);
      // Off the lift or the stairs he faces the way on (after this move is done).
      const position = session.position;
      if (session.view === "walk" && next > 0) requestAnimationFrame(() => { if (session?.indoor?.index === next && walk.isActive()) walk.setPose(position, bearingAt(stage.model, 0, 3)); });
    } else onToast?.(`${stage.name}: choose ${indoor.levelName(stage.toLevel)} on the floor selector, or press Page ${stage.direction === "up" ? "Up" : "Down"}.`);
  }

  // Off the indoor route: away from the line of the leg he is on, on a floor the
  // route does not use, or walking away from the lift or stairs to be taken.
  function offIndoorRoute(where) {
    const stage = indoorStage();
    if (!stage || !where || where.building !== stage.building) return false;
    if (stage.type === "walk") return where.level !== stage.level || (session.progress?.offsetM ?? 0) > INDOOR_OFF_ROUTE_M;
    if (where.level === stage.toLevel) return false;
    if (where.level !== stage.fromLevel || !stage.point) return true;
    const frame = createLocalFrame(stage.point);
    return distance(frame.toLocal(session.position), [0, 0]) > INDOOR_OFF_CONNECTOR_M;
  }
  // A new route inside from where he is (the floors may have to be read first).
  function maybeRerouteIndoor() {
    const { indoor } = session;
    const where = getIndoorPosition?.() || null;
    const now = performance.now();
    if (!rerouteIndoor || indoor.rerouting || now - (indoor.reroutedAt || 0) < INDOOR_REROUTE_INTERVAL_MS || !offIndoorRoute(where)) return;
    indoor.rerouting = true;
    indoor.reroutedAt = now;
    const current = session;
    Promise.resolve(rerouteIndoor(session.position, where)).catch(() => null).then((legs) => {
      if (session !== current || session.indoor !== indoor) return;
      indoor.rerouting = false;
      const stages = legs ? indoorStages(legs) : [];
      if (!stages.length || session.arrived) return;
      indoor.stages = stages;
      indoor.index = 0;
      if (stages[0].type === "walk") {
        session.model = stages[0].model;
        session.progress = locate(session.model, session.position);
      }
      render();
    });
  }

  // ---- Heading and camera animation ---------------------------------------------
  function chosenHeading() {
    const fromCompass = compass.heading();
    if (fromCompass !== null) return fromCompass;
    if (session.course !== null && session.speed > 0.6) return session.course;
    if (session.progress && !session.offRoute) return session.progress.bearing;
    return null;
  }

  function updateHeadingTarget() {
    if (!session || (session.view === "walk" && session.source !== "gps")) return;
    const heading = chosenHeading();
    if (heading === null) return;
    if (anim.target !== null && Math.abs(angleDelta(anim.target, heading)) < HEADING_DEADBAND_DEG) return;
    anim.target = heading;
    if (anim.heading === null) anim.heading = heading;
    wake();
  }

  function animateTo(position) {
    anim.from = anim.center || position;
    anim.to = position;
    anim.start = performance.now();
    wake();
  }

  function wake() {
    if (!anim.frame) anim.frame = requestAnimationFrame(tick);
  }

  function tick(time) {
    anim.frame = 0;
    if (!session) return;
    const dt = anim.last ? Math.min(0.1, (time - anim.last) / 1000) : 1 / 60;
    anim.last = time;
    let moving = false;
    if (anim.to) {
      const t = Math.min(1, (time - anim.start) / POSITION_EASE_MS);
      const eased = 1 - (1 - t) ** 3;
      anim.center = [anim.from[0] + (anim.to[0] - anim.from[0]) * eased, anim.from[1] + (anim.to[1] - anim.from[1]) * eased];
      moving = t < 1;
    }
    if (anim.target !== null) {
      const delta = angleDelta(anim.heading, anim.target);
      if (Math.abs(delta) < 0.3) anim.heading = anim.target;
      else { anim.heading = normalizeDegrees(anim.heading + delta * (1 - Math.exp(-dt / HEADING_SMOOTHING_S))); moving = true; }
    }
    // A zoom-button animation (or a gesture) runs first; following resumes after it.
    const waiting = session.view === "map" && session.follow && !session.intro && map.isMoving();
    applyPose();
    if (moving || waiting) anim.frame = requestAnimationFrame(tick);
    else anim.last = 0;
  }

  function applyPose() {
    if (!anim.center) return;
    if (session.view === "walk") {
      if (session.source === "gps") walk.setPose(anim.center, anim.heading);
      return;
    }
    marker.setLngLat(anim.center).setRotation(anim.heading ?? 0);
    if (!markerShown) { marker.addTo(map); markerShown = true; }
    markerElement.classList.toggle("has-heading", anim.heading !== null);
    if (session.follow && !session.intro && !map.isMoving()) map.jumpTo({ center: anim.center, bearing: anim.heading ?? map.getBearing() });
  }

  // The position sits in the lower part of the view, above the bottom sheet.
  function followPadding() {
    const height = map.getCanvas().clientHeight;
    const sheet = ui.sheet.hidden ? 0 : ui.sheet.offsetHeight + 12;
    const bottom = Math.min(sheet, height * 0.4);
    return { top: Math.round((height - bottom) * FOLLOW_TOP_PADDING), bottom: Math.round(bottom), left: 0, right: 0 };
  }

  // Map view: ease to the position, then follow it. (A timer, not "moveend",
  // ends the intro: easing interrupts any running animation, which fires its
  // own moveend.)
  function enterFollowCamera() {
    if (!session) return;
    const center = anim.center || session.position || session.model.coordinates[0];
    const bearing = anim.heading ?? (session.progress ? session.progress.bearing : bearingAt(session.model, 0));
    session.follow = true;
    session.intro = true;
    render(); // shows the sheet, whose height sets the padding
    clearTimeout(introTimer);
    introTimer = setTimeout(() => { if (session) { session.intro = false; wake(); } }, INTRO_MS + 60);
    map.easeTo({ center, bearing, zoom: map.getZoom() < FOLLOW_ZOOM - 0.5 ? FOLLOW_ZOOM : Math.min(FOLLOW_ZOOM + 1, map.getZoom()), pitch: FOLLOW_PITCH, padding: followPadding(), duration: INTRO_MS, essential: true });
  }

  // ---- Position ------------------------------------------------------------------
  function onCampus(position) {
    return !campusCenter || distance(createLocalFrame(campusCenter).toLocal(position), [0, 0]) <= CAMPUS_RANGE_M;
  }

  function updatePosition(position, { source, accuracy = null, course = null, speed = null } = {}) {
    if (!session?.model) return;
    const now = performance.now();
    session.position = position;
    session.source = source;
    session.accuracy = accuracy;
    session.course = Number.isFinite(course) ? course : null;
    session.speed = Number.isFinite(speed) ? speed : null;
    const progress = locate(session.model, position, { hint: session.progress?.along ?? null });
    session.progress = progress;
    if (session.indoor) {
      // Inside: the stages of the indoor route, found again from here when he leaves it.
      if (!session.arrived) followIndoor();
      if (!session.arrived) maybeRerouteIndoor();
    } else {
      const reliable = accuracy === null || accuracy <= UNUSABLE_GPS_M;
      const threshold = Math.max(offRouteRule(source).offM, Math.min(35, (accuracy || 0) * 1.2));
      if (reliable && progress.offsetM > threshold && !session.arrived) session.offRouteSince ||= now;
      else session.offRouteSince = 0;
      if (!session.arrived && progress.along >= session.model.total - ARRIVAL_M && progress.offsetM < 15) arrive();
      checkRoute(now);
    }
    if (source === "gps") setAccuracy(position, accuracy);
    if (session.view === "map" || source === "gps") {
      const shown = session.view === "walk" && collision ? collision.nearestFree(position) : position;
      // In 3D mode the position waited for is not eased in from the route start: the
      // walker stands where the visitor stands.
      if (session.snapToGps && source === "gps") { session.snapToGps = false; anim.center = shown; anim.to = null; walk.setPose?.(shown, anim.heading ?? 0); }
      animateTo(shown);
      updateHeadingTarget();
    }
    render();
  }

  // Off route once away from it for the rule's confirmMs, re-route after its
  // rerouteMs (OFF_ROUTE). A standing phone may send no new position, so a timer
  // checks again when the next of these moments comes.
  function checkRoute(now = performance.now()) {
    clearTimeout(routeCheckTimer);
    if (!session) return;
    const wasOff = session.offRoute;
    const rule = offRouteRule(session.source);
    session.offRoute = Boolean(session.offRouteSince) && now - session.offRouteSince >= rule.confirmMs;
    maybeReroute(now);
    if (session.offRouteSince) {
      const due = [rule.confirmMs, rule.rerouteMs, session.lastRerouteAt + rule.intervalMs - session.offRouteSince].map((ms) => session.offRouteSince + ms - now).filter((ms) => ms > 0);
      if (due.length) routeCheckTimer = setTimeout(() => { checkRoute(); render(); }, Math.min(...due) + 20);
    }
    if (wasOff !== session.offRoute) updateHeadingTarget();
  }

  function arrive() {
    // In 3D mode a route to a room goes on inside the building.
    if (session.view === "walk" && beginIndoor()) return;
    session.arrived = true;
    session.offRoute = false;
    session.offRouteSince = 0;
    const indoor = collision?.hasIndoor?.(session.destinationId);
    session.arrivalNote = !indoor
      ? `Indoor directions are not available: ${destinationName()} has no indoor map, and GPS cannot tell floors or rooms.`
      : session.view === "walk" ? `${destinationName()} has floor plans: walk in through its entrance.` : "";
    onToast?.(`You have arrived at ${destinationName()}`);
  }

  function maybeReroute(now) {
    if (!session.offRoute || !reroute || !session.position) return;
    const rule = offRouteRule(session.source);
    if (now - session.offRouteSince < rule.rerouteMs || session.progress.offsetM < rule.rerouteM || now - session.lastRerouteAt < rule.intervalMs) return;
    if (session.source === "gps" && (session.accuracy ?? 0) > 25) return;
    if (!onCampus(session.position)) return;
    session.lastRerouteAt = now;
    const before = session.result?.path?.join("|");
    const next = reroute(session.position);
    if (next?.ok && useRoute(next)) {
      session.progress = locate(session.model, session.position);
      session.offRouteSince = session.progress.offsetM > rule.offM ? now : 0;
      session.offRoute = false;
      // Said only when the way itself has changed, not for the same roads from a new spot.
      if (next.path?.join("|") !== before) onToast?.("Rerouted from your position");
    }
  }

  // ---- GPS -----------------------------------------------------------------------
  function startGps() {
    if (!session || gps.watchId !== null) return;
    session.gpsRequested = true;
    if (!window.isSecureContext) { gps.status = "insecure"; render(); return; }
    if (!("geolocation" in navigator)) { gps.status = "unavailable"; render(); return; }
    gps.status = "waiting";
    gps.watchId = navigator.geolocation.watchPosition(onFix, onGpsError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    clearTimeout(gps.noFixTimer);
    gps.noFixTimer = setTimeout(() => { if (session && !gps.fix) { gps.status = gps.status === "waiting" ? "slow" : gps.status; render(); } }, NO_FIX_HINT_MS);
    render();
  }

  function stopGps() {
    if (gps.watchId !== null) navigator.geolocation?.clearWatch(gps.watchId);
    gps.watchId = null;
    gps.status = "off";
    gps.fix = null;
    clearTimeout(gps.noFixTimer);
  }

  function onFix(position) {
    if (!session) return;
    const { longitude, latitude, accuracy, heading, speed } = position.coords;
    const point = [longitude, latitude];
    gps.fix = { point, accuracy, heading, speed, time: position.timestamp };
    if (!onCampus(point)) {
      gps.status = "far";
      if (session.view === "walk" && session.snapToGps) {
        session.snapToGps = false;
        session.useGps = false;
        if (session.source === "none") session.source = "manual";
        onToast?.("Your position is away from the campus, so the walk starts at the route.");
      }
      render();
      return;
    }
    gps.status = accuracy > WEAK_GPS_M ? "weak" : "live";
    if (session.useGps) updatePosition(point, { source: "gps", accuracy, course: heading, speed });
    else render();
  }

  function onGpsError(error) {
    if (!session) return;
    gps.status = error?.code === 1 ? "denied" : error?.code === 3 ? "slow" : "unavailable";
    if (error?.code === 1) stopWatchOnly();
    if (session.view === "walk" && session.snapToGps && gps.status !== "slow") {
      session.snapToGps = false;
      session.useGps = false;
      session.source = session.source === "none" ? "manual" : session.source;
      onToast?.(gps.status === "denied" ? "Location is blocked for this site, so the walk starts at the route. Allow it in the browser’s site settings." : "Your location is not available, so the walk starts at the route.");
    }
    render();
  }
  function stopWatchOnly() {
    if (gps.watchId !== null) navigator.geolocation?.clearWatch(gps.watchId);
    gps.watchId = null;
  }
  const gpsUsable = () => gps.fix && (gps.status === "live" || gps.status === "weak");

  // ---- Accuracy circle --------------------------------------------------------------
  function setAccuracy(position, accuracy) {
    const source = map.getSource("nav-accuracy");
    if (!source) {
      if (!position) return;
      map.addSource("nav-accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "nav-accuracy-fill", type: "fill", source: "nav-accuracy", paint: { "fill-color": STYLE.pinSource, "fill-opacity": 0.12, "fill-outline-color": "rgba(30, 136, 229, 0.45)" } }, map.getLayer(GARDEN_LAYER) ? GARDEN_LAYER : undefined);
    }
    const data = position && Number.isFinite(accuracy) && accuracy > 3 ? { type: "FeatureCollection", features: [circlePolygon(position, Math.min(accuracy, 150))] } : { type: "FeatureCollection", features: [] };
    map.getSource("nav-accuracy")?.setData(data);
  }

  // ---- Rendering ---------------------------------------------------------------------
  function gpsStatusText() {
    switch (gps.status) {
      case "waiting": return "Waiting for GPS…";
      case "slow": return "No GPS position yet";
      case "live": return `GPS ±${Math.round(gps.fix.accuracy)} m`;
      case "weak": return `Weak GPS ±${Math.round(gps.fix.accuracy)} m`;
      case "denied": return "Location permission not given";
      case "unavailable": return "Location unavailable on this device";
      case "insecure": return "Location needs an https:// address";
      case "far": return "GPS: away from the campus";
      default: return "";
    }
  }
  function compassStatusText() {
    switch (compass.status()) {
      case "live": return "compass on";
      case "inaccurate": return "compass needs calibrating: move the phone in a figure 8";
      case "unavailable": return "no compass: the map turns with your walking direction";
      case "denied": return "compass not allowed: the map turns with your walking direction";
      case "requesting": return "asking for the compass…";
      default: return "";
    }
  }

  function alertText() {
    if (session.picking) return "Tap the map where you are standing.";
    if (session.arrived) return session.arrivalNote || "";
    if (session.source === "manual" || session.view === "walk") return "";
    if (!session.gpsRequested) return "";
    if (gps.status === "denied" || gps.status === "unavailable" || gps.status === "insecure" || gps.status === "slow") return "Your location is not available. Tap “Set position” to place yourself, or use 3D mode to walk the route.";
    if (gps.status === "far") return `You are ${formatDistance(distance(createLocalFrame(campusCenter).toLocal(gps.fix.point), [0, 0]))} from the campus. Guidance starts on campus; tap “Set position” to preview it.`;
    if (gps.status === "weak") return `Weak GPS signal (±${Math.round(gps.fix.accuracy)} m): your position may jump. Indoors, tap “Set position”.`;
    return "";
  }

  function render() {
    if (!session?.model) return;
    const { model, progress } = session;
    const along = progress?.along ?? 0;
    const g = guidance(model, along);
    const stage = indoorStage();
    const target = stage ? (stage.type === "walk" ? stage.to : session.indoor.name) : session.destinationName;
    let icon = g.next.type, rotation = 0, distanceText = formatGuidanceDistance(g.distanceToNext), text = maneuverText(g.next, target), then = "";
    let remainingM = g.remaining + (stage ? remainingAfter(session.indoor.stages, session.indoor.index) : 0);
    if (session.arrived) {
      icon = "arrive"; distanceText = ""; text = `You have arrived at ${session.indoor?.name || destinationName()}`; remainingM = 0;
    } else if (stage?.type === "connector") {
      // At the lift or the stairs: the floor to go to.
      icon = stage.class === "lift" ? "lift" : "stairs"; distanceText = session.indoor.levelName(stage.toLevel);
      text = `Take ${stage.name} ${stage.direction} to ${session.indoor.levelName(stage.toLevel)}`;
      then = `Choose ${session.indoor.levelName(stage.toLevel)} on the floor selector, or press Page ${stage.direction === "up" ? "Up" : "Down"}`;
      remainingM = remainingAfter(session.indoor.stages, session.indoor.index);
    } else if (stage && session.indoor.index === 0 && !getIndoorPosition?.()) {
      icon = "enter"; distanceText = formatGuidanceDistance(Math.max(0, progress?.offsetM ?? 0));
      text = "Walk in through the entrance"; then = `Then on to ${stage.to}`;
    } else if (session.offRoute && progress) {
      const here = model.frame.toLocal(session.position);
      const bearing = bearingOf(here, progress.point);
      icon = "straight"; rotation = angleDelta(anim.heading ?? map.getBearing(), bearing);
      distanceText = formatGuidanceDistance(progress.offsetM); text = "Off route";
      then = `Walk ${compassWord(bearing)} to rejoin the route`;
    } else {
      if (g.following) then = `Then ${maneuverText(g.following, target).replace(/^./, (c) => c.toLowerCase())}`;
      else if (along < 5 && g.next.type !== "arrive" && !stage) then = `${maneuverText(model.maneuvers[0])} to start`;
    }
    const iconKey = `${icon}:${Math.round(rotation / 5)}`;
    if (texts.get(ui.icon) !== iconKey) { texts.set(ui.icon, iconKey); ui.icon.innerHTML = iconSvg(icon, rotation); }
    ui.banner.dataset.state = session.arrived ? "arrived" : session.offRoute ? "off-route" : "on-route";
    setText(ui.distance, distanceText);
    setText(ui.text, text);
    setText(ui.then, then);
    setHidden(ui.then, !then);
    const place = session.indoor?.name || destinationName();
    const eta = session.arrived ? "Arrived" : `${walkingMinutes(remainingM)} min`;
    const remaining = session.arrived ? place : `${formatDistance(remainingM)} · ${place}`;
    setText(ui.eta, eta);
    setText(ui.remaining, remaining);
    setText(ui.line, `${eta} · ${remaining}`);
    const alert = alertText();
    setText(ui.alert, alert);
    setHidden(ui.alert, !alert);
    const sourceText = session.source === "manual" ? "Position set by hand" : session.source === "gps" ? gpsStatusText() : session.gpsRequested ? gpsStatusText() : "GPS off";
    setText(ui.status, [sourceText, session.source === "gps" || session.gpsRequested ? compassStatusText() : ""].filter(Boolean).join(" · "));
    // Controls.
    const walkView = session.view === "walk";
    setHidden(ui.sheet, walkView);
    setHidden(ui.recenter, walkView || session.follow);
    setHidden(ui.gps, walkView || session.useGps || !gpsUsable());
    setText(ui.view, walkView ? "Map view" : "3D mode");
    ui.position.setAttribute("aria-pressed", String(session.picking));
    setText(ui.position, session.picking ? "Cancel" : "Set position");
    if (ui.walkGps) {
      setHidden(ui.walkGps, !walkView);
      ui.walkGps.setAttribute("aria-pressed", String(session.useGps));
      setText(ui.walkGps, session.useGps ? (session.source === "gps" ? "Following GPS" : "Waiting for GPS…") : "Follow GPS");
    }
  }

  // ---- Views ---------------------------------------------------------------------------
  function setView(view) {
    if (!session || session.view === view) return;
    if (view === "walk") {
      session.view = "walk";
      session.picking = false;
      marker.remove(); markerShown = false;
      const useGps = session.useGps && gpsUsable();
      // Waiting for the first position: the walk starts at the beginning of the route
      // and jumps to the visitor as soon as the GPS gives a position.
      session.snapToGps = session.useGps && !useGps;
      if (session.snapToGps) {
        if (!session.gpsRequested) startGps();
        if (gps.status === "waiting" || gps.status === "slow") onToast?.("Waiting for your GPS position…");
      }
      const start = useGps ? (session.source === "gps" && session.position) || gps.fix.point : (session.source === "manual" && session.position) || session.model.coordinates[0];
      const free = collision ? collision.nearestFree(start) : start;
      const heading = (useGps ? chosenHeading() : null) ?? bearingAt(session.model, session.progress?.along ?? 0);
      session.source = useGps ? "gps" : "manual";
      anim.center = free;
      anim.to = null;
      anim.heading = heading;
      anim.target = useGps ? anim.target : null;
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      walk.open(free, { heading });
    } else {
      session.view = "map";
      if (walk.isActive()) walk.close({ restoreCamera: false, message: null });
      const pose = walk.getPose();
      if (pose && session.source !== "gps") { anim.center = pose.position; anim.heading = pose.heading; }
      enterFollowCamera();
    }
    render();
  }

  // ---- Public API ------------------------------------------------------------------------
  function start({ view = "map" } = {}) {
    const result = getRoute?.();
    if (!result?.ok) { onToast?.("Choose a starting point and a destination with a walking route first"); return false; }
    compass.start(); // iOS: must run inside the tap
    if (session) {
      if (!session.gpsRequested) { session.useGps = true; startGps(); }
      setView(view);
      return true;
    }
    session = {
      view: "map", source: "none", useGps: true, gpsRequested: false, snapToGps: false, follow: true, intro: false, picking: false,
      position: null, accuracy: null, course: null, speed: null, progress: null, offRouteSince: 0, offRoute: false,
      arrived: false, arrivalNote: "", lastRerouteAt: 0, result: null, model: null, destinationName: "", destinationId: "",
      savedCamera: { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), padding: { ...map.getPadding() } }
    };
    if (!useRoute(result)) { session = null; onToast?.("This route cannot be followed"); return false; }
    texts.clear();
    anim.center = null; anim.to = null; anim.heading = null; anim.target = null;
    document.documentElement.classList.add("nav-active");
    ui.banner.hidden = false;
    cameraController?.release?.();
    onSession?.(true);
    startGps();
    render();
    if (view === "walk") setView("walk");
    else enterFollowCamera();
    return true;
  }

  function end({ restoreCamera = true } = {}) {
    if (!session) return;
    const ended = session;
    session = null;
    clearTimeout(routeCheckTimer);
    clearTimeout(introTimer);
    cancelAnimationFrame(anim.frame);
    anim.frame = 0;
    anim.last = 0;
    stopGps();
    compass.stop();
    marker.remove(); markerShown = false;
    setAccuracy(null, null);
    if (walk.isActive()) walk.close({ restoreCamera: false, message: null });
    ui.banner.hidden = true;
    ui.sheet.hidden = true;
    ui.alert.hidden = true;
    if (ui.walkGps) ui.walkGps.hidden = true;
    map.getCanvas().style.cursor = "";
    document.documentElement.classList.remove("nav-active");
    if (restoreCamera) map.easeTo({ ...ended.savedCamera, duration: 700, essential: true });
    onSession?.(false);
    onToast?.("Navigation ended");
  }

  function setPicking(next) {
    if (!session) return;
    session.picking = next;
    map.getCanvas().style.cursor = next ? "crosshair" : "";
    render();
  }

  ui.close?.addEventListener("click", () => end());
  ui.end?.addEventListener("click", () => end());
  ui.view?.addEventListener("click", () => setView(session?.view === "walk" ? "map" : "walk"));
  ui.recenter?.addEventListener("click", () => enterFollowCamera());
  ui.position?.addEventListener("click", () => setPicking(!session?.picking));
  ui.gps?.addEventListener("click", () => {
    if (!session) return;
    session.useGps = true;
    if (gps.fix) onFix({ coords: { longitude: gps.fix.point[0], latitude: gps.fix.point[1], accuracy: gps.fix.accuracy, heading: gps.fix.heading, speed: gps.fix.speed }, timestamp: gps.fix.time });
    render();
  });
  ui.walkGps?.addEventListener("click", () => {
    if (!session) return;
    compass.start();
    if (!session.gpsRequested) startGps();
    if (session.useGps && session.source === "gps") { session.useGps = false; session.source = "manual"; render(); return; }
    session.useGps = true;
    if (gpsUsable()) { session.source = "gps"; updatePosition(gps.fix.point, { source: "gps", accuracy: gps.fix.accuracy, course: gps.fix.heading, speed: gps.fix.speed }); }
    else onToast?.("Waiting for a GPS position…");
    render();
  });

  map.on("click", (event) => {
    if (!session?.picking) return;
    session.useGps = false;
    setPicking(false);
    updatePosition(event.lngLat.toArray(), { source: "manual" });
    onToast?.("Position set. Tap “Use GPS” to follow your phone's location again.");
  });

  // Esc on the map ends navigation (in 3D mode walk mode takes Esc first: it leaves
  // 3D mode and marks the key as used).
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !session || session.view !== "map" || walk.isActive()) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
    event.preventDefault();
    if (session.picking) setPicking(false); else end();
  });

  // A pan, rotation or zoom by the user pauses following; Recenter resumes it.
  ["dragstart", "rotatestart", "pitchstart", "zoomstart"].forEach((name) => map.on(name, (event) => {
    if (!session || session.view !== "map" || !event.originalEvent || session.intro) return;
    if (session.follow) { session.follow = false; render(); }
  }));

  return {
    start,
    end,
    isActive: () => Boolean(session),
    isPickingPosition: () => Boolean(session?.picking),
    // A new or changed route while navigating (endpoints edited, live reload).
    setRoute(result) {
      if (!session) return;
      if (!result?.ok || !useRoute(result)) { end(); return; }
      if (session.position) session.progress = locate(session.model, session.position);
      render();
    },
    onWalkPose(pose) {
      if (!session || session.view !== "walk" || session.source === "gps" || !pose) return;
      updatePosition(pose.position, { source: "manual" });
    },
    onWalkState(state) {
      if (!session) return;
      if (state === "active" && session.view !== "walk") { session.view = "walk"; session.source = "manual"; marker.remove(); markerShown = false; render(); }
      if (state === "idle" && session.view === "walk") {
        session.view = "map";
        enterFollowCamera();
        onToast?.("3D mode off — navigation continues on the map");
      }
    },
    onManualInput() {
      if (!session || session.view !== "walk" || session.source !== "gps") return;
      session.source = "manual";
      session.useGps = false;
      render();
    },
    // Route assist: walking forward turns the walker towards the route ahead.
    steer({ position, heading, deltaSeconds }) {
      if (!session || session.view !== "walk" || session.source === "gps" || session.arrived || session.offRoute) return 0;
      const progress = session.progress;
      // Outside the destination building it also leads him to its entrance from a little farther.
      if (!progress || progress.offsetM > (session.indoor && !getIndoorPosition?.() ? 20 : 4)) return 0;
      const here = session.model.frame.toLocal(position);
      const ahead = pointAt(session.model, progress.along + 6);
      if (distance(here, ahead) < 1) return 0;
      const delta = angleDelta(heading, bearingOf(here, ahead));
      if (Math.abs(delta) > 100) return 0;
      const limit = ASSIST_DEG_PER_S * deltaSeconds;
      return Math.max(-limit, Math.min(limit, delta));
    },
    // Diagnostics and automated tests.
    state: () => (session ? {
      view: session.view, source: session.source, follow: session.follow, offRoute: session.offRoute, arrived: session.arrived,
      along: session.progress?.along ?? null, offsetM: session.progress?.offsetM ?? null, total: session.model?.total ?? null,
      banner: ui.text.textContent, distance: ui.distance.textContent, then: ui.then.textContent, alert: ui.alert.hidden ? "" : ui.alert.textContent,
      status: ui.status.textContent, gps: gps.status, compass: compass.status(), heading: anim.heading, maneuvers: session.model.maneuvers.map((m) => m.type),
      indoor: session.indoor ? { index: session.indoor.index, stages: session.indoor.stages.map((stage) => (stage.type === "walk" ? `walk:${stage.level}` : `${stage.class}:${stage.toLevel}`)) } : null
    } : null),
    feedPosition(lngLat, { accuracy = 5, heading = null, speed = null } = {}) {
      onFix({ coords: { longitude: lngLat[0], latitude: lngLat[1], accuracy, heading, speed }, timestamp: Date.now() });
    },
    feedCompass(heading, accuracy = 5) { compass.inject({ webkitCompassHeading: heading, webkitCompassAccuracy: accuracy }); }
  };
}
