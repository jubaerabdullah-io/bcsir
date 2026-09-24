// Live route guidance (Google Maps style) for the calculated walking route.
//
// Start: follows the phone's GPS position along the route. The map turns with
// the phone's compass (walking direction when there is no usable compass),
// with the user's position in the lower part of the screen. A banner shows the
// next turn and its distance, the sheet the remaining distance and time.
// Leaving the route shows the way back to it; staying off it re-routes from
// the current position with the original routing algorithm.
// 3D mode: the same session in first-person walk mode (walkMode.js), with the
// route and destination kept. Driven by the on-screen / keyboard controls, or
// by GPS and the compass after "Follow GPS".
//
// GPS does not tell floors or rooms, and no building has an indoor map, so
// guidance ends at the building (its recorded entrance, else the edge of its
// footprint). Where GPS is missing, refused, weak or far from the campus, the
// position can be set by tapping the map ("Set position"), or walked in 3D mode.
//
// Rendering: the camera and the position marker are animated in one
// requestAnimationFrame loop that runs only while something moves (a new GPS
// position is eased in over ~1 s; the heading is smoothed); it stops when the
// position and heading are settled. DOM text is only written when it changes.
import * as maplibregl from "maplibre-gl";
import { formatDistance, walkingMinutes } from "../route-summary.js";
import { routePathCoordinates } from "../route-walker.js";
import { createCompass } from "./compass.js";
import { angleDelta, bearingOf, createLocalFrame, distance, geometryPolygons, insideRings, normalizeDegrees } from "./local-frame.js";
import { bearingAt, compassWord, createRouteModel, formatGuidanceDistance, guidance, locate, maneuverText, pointAt } from "./route-progress.js";

const FOLLOW_ZOOM = 19;
const FOLLOW_PITCH = 60;
const FOLLOW_TOP_PADDING = 0.4; // share of the screen height above the position
const INTRO_MS = 900;
const POSITION_EASE_MS = 900;
const HEADING_SMOOTHING_S = 0.18;
const HEADING_DEADBAND_DEG = 1.2;
const OFF_ROUTE_MIN_M = 12;
const OFF_ROUTE_CONFIRM_MS = 2500;
const REROUTE_AFTER_MS = 8000;
const REROUTE_MIN_M = 20;
const REROUTE_INTERVAL_MS = 15000;
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
  depart: "M12 20V5M12 5l-5 5M12 5l5 5"
};

function iconSvg(type, rotation = 0) {
  const path = ICON_PATHS[type] || ICON_PATHS.straight;
  const filled = type === "arrive";
  return `<svg viewBox="0 0 24 24" style="transform: rotate(${Math.round(rotation)}deg)" aria-hidden="true"><path d="${path}" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;
}

function circlePolygon(center, radiusM, steps = 40) {
  const frame = createLocalFrame(center);
  const ring = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    ring.push(frame.toLngLat([Math.cos(a) * radiusM, Math.sin(a) * radiusM]));
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
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

export function createLiveNavigation({ map, walk, getRoute, reroute, collision, campusCenter, cameraController, onSession, onToast } = {}) {
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
    return true;
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
    const reliable = accuracy === null || accuracy <= UNUSABLE_GPS_M;
    const threshold = Math.max(OFF_ROUTE_MIN_M, Math.min(35, (accuracy || 0) * 1.2));
    if (reliable && progress.offsetM > threshold && !session.arrived) session.offRouteSince ||= now;
    else session.offRouteSince = 0;
    if (!session.arrived && progress.along >= session.model.total - ARRIVAL_M && progress.offsetM < 15) arrive();
    checkRoute(now);
    if (source === "gps") setAccuracy(position, accuracy);
    if (session.view === "map" || source === "gps") {
      const shown = session.view === "walk" && collision ? collision.nearestFree(position) : position;
      animateTo(shown);
      updateHeadingTarget();
    }
    render();
  }

  // Off route once away from it for OFF_ROUTE_CONFIRM_MS, re-route after
  // REROUTE_AFTER_MS. A standing phone may send no new position, so a timer
  // checks again when the next of these moments comes.
  function checkRoute(now = performance.now()) {
    clearTimeout(routeCheckTimer);
    if (!session) return;
    const wasOff = session.offRoute;
    session.offRoute = Boolean(session.offRouteSince) && now - session.offRouteSince >= OFF_ROUTE_CONFIRM_MS;
    maybeReroute(now);
    if (session.offRouteSince) {
      const due = [OFF_ROUTE_CONFIRM_MS, REROUTE_AFTER_MS].map((ms) => session.offRouteSince + ms - now).filter((ms) => ms > 0);
      if (due.length) routeCheckTimer = setTimeout(() => { checkRoute(); render(); }, Math.min(...due) + 20);
    }
    if (wasOff !== session.offRoute) updateHeadingTarget();
  }

  function arrive() {
    session.arrived = true;
    session.offRoute = false;
    session.offRouteSince = 0;
    const indoor = collision?.hasIndoor?.(session.destinationId);
    session.arrivalNote = indoor ? "" : `Indoor directions are not available: ${destinationName()} has no indoor map, and GPS cannot tell floors or rooms.`;
    onToast?.(`You have arrived at ${destinationName()}`);
  }

  function maybeReroute(now) {
    if (!session.offRoute || !reroute || !session.position) return;
    if (now - session.offRouteSince < REROUTE_AFTER_MS || session.progress.offsetM < REROUTE_MIN_M || now - session.lastRerouteAt < REROUTE_INTERVAL_MS) return;
    if (session.source === "gps" && (session.accuracy ?? 0) > 25) return;
    if (!onCampus(session.position)) return;
    session.lastRerouteAt = now;
    const next = reroute(session.position);
    if (next?.ok && useRoute(next)) {
      session.progress = locate(session.model, session.position);
      session.offRouteSince = session.progress.offsetM > OFF_ROUTE_MIN_M ? now : 0;
      session.offRoute = false;
      onToast?.("Rerouted from your position");
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
    if (!onCampus(point)) { gps.status = "far"; render(); return; }
    gps.status = accuracy > WEAK_GPS_M ? "weak" : "live";
    if (session.useGps) updatePosition(point, { source: "gps", accuracy, course: heading, speed });
    else render();
  }

  function onGpsError(error) {
    if (!session) return;
    gps.status = error?.code === 1 ? "denied" : error?.code === 3 ? "slow" : "unavailable";
    if (error?.code === 1) stopWatchOnly();
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
      map.addLayer({ id: "nav-accuracy-fill", type: "fill", source: "nav-accuracy", paint: { "fill-color": "#1e88e5", "fill-opacity": 0.12, "fill-outline-color": "rgba(30, 136, 229, 0.45)" } }, map.getLayer("garden-3d") ? "garden-3d" : undefined);
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
    let icon = g.next.type, rotation = 0, distanceText = formatGuidanceDistance(g.distanceToNext), text = maneuverText(g.next, session.destinationName), then = "";
    if (session.arrived) {
      icon = "arrive"; distanceText = ""; text = `You have arrived at ${destinationName()}`;
    } else if (session.offRoute && progress) {
      const here = model.frame.toLocal(session.position);
      const bearing = bearingOf(here, progress.point);
      icon = "straight"; rotation = angleDelta(anim.heading ?? map.getBearing(), bearing);
      distanceText = formatGuidanceDistance(progress.offsetM); text = "Off route";
      then = `Walk ${compassWord(bearing)} to rejoin the route`;
    } else {
      if (g.following) then = `Then ${maneuverText(g.following, session.destinationName).replace(/^./, (c) => c.toLowerCase())}`;
      else if (along < 5 && g.next.type !== "arrive") then = `${maneuverText(model.maneuvers[0])} to start`;
    }
    const iconKey = `${icon}:${Math.round(rotation / 5)}`;
    if (texts.get(ui.icon) !== iconKey) { texts.set(ui.icon, iconKey); ui.icon.innerHTML = iconSvg(icon, rotation); }
    ui.banner.dataset.state = session.arrived ? "arrived" : session.offRoute ? "off-route" : "on-route";
    setText(ui.distance, distanceText);
    setText(ui.text, text);
    setText(ui.then, then);
    setHidden(ui.then, !then);
    const eta = session.arrived ? "Arrived" : `${walkingMinutes(g.remaining)} min`;
    const remaining = session.arrived ? destinationName() : `${formatDistance(g.remaining)} · ${destinationName()}`;
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
      ui.walkGps.setAttribute("aria-pressed", String(session.useGps && session.source === "gps"));
      setText(ui.walkGps, session.useGps && session.source === "gps" ? "Following GPS" : "Follow GPS");
    }
  }

  // ---- Views ---------------------------------------------------------------------------
  function setView(view) {
    if (!session || session.view === view) return;
    if (view === "walk") {
      session.view = "walk";
      session.picking = false;
      marker.remove(); markerShown = false;
      const useGps = session.useGps && gpsUsable() && session.source === "gps";
      const start = useGps ? session.position : (session.source === "manual" && session.position) || session.model.coordinates[0];
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
    const live = view === "map";
    if (live) compass.start(); // iOS: must run inside the tap
    if (session) {
      if (live && !session.gpsRequested) { session.useGps = true; startGps(); }
      setView(view);
      return true;
    }
    session = {
      view: "map", source: "none", useGps: live, gpsRequested: false, follow: true, intro: false, picking: false,
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
    if (live) startGps();
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
      if (!progress || progress.offsetM > 4) return 0;
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
      status: ui.status.textContent, gps: gps.status, compass: compass.status(), heading: anim.heading, maneuvers: session.model.maneuvers.map((m) => m.type)
    } : null),
    feedPosition(lngLat, { accuracy = 5, heading = null, speed = null } = {}) {
      onFix({ coords: { longitude: lngLat[0], latitude: lngLat[1], accuracy, heading, speed }, timestamp: Date.now() });
    },
    feedCompass(heading, accuracy = 5) { compass.inject({ webkitCompassHeading: heading, webkitCompassAccuracy: accuracy }); }
  };
}
