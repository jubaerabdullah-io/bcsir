// Reused from the reference indoor-mapping project (src/camera-controls.js).
// BCSIR additions: "isometric" preset, rotateBy()/tiltBy() for the on-screen
// rotate and tilt buttons, and campus wording in messages.
const PRESET_DURATION = 650;
// True isometric projection: camera elevation atan(1/sqrt(2)) = 35.264 degrees.
const ISOMETRIC_PITCH = 90 - Math.atan(1 / Math.SQRT2) * 180 / Math.PI;
const ROTATE_STEP = 22.5;
const TILT_STEP = 10;
const HEADING_THRESHOLD = 3;
const HEADING_MIN_INTERVAL = 160;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeBearing(value) {
  const number = finiteNumber(value) ?? 0;
  return ((number % 360) + 360) % 360;
}

export function shortestBearing(current, target) {
  const start = finiteNumber(current) ?? 0;
  const delta = ((normalizeBearing(target) - normalizeBearing(start) + 540) % 360) - 180;
  return start + delta;
}

function angularDifference(a, b) {
  return Math.abs(((normalizeBearing(a) - normalizeBearing(b) + 540) % 360) - 180);
}

function smoothBearing(previous, next, amount = .22) {
  if (!Number.isFinite(previous)) return normalizeBearing(next);
  const nearest = shortestBearing(previous, next);
  return normalizeBearing(previous + (nearest - previous) * amount);
}

export function calculateBearing(startCoordinate, endCoordinate) {
  if (!Array.isArray(startCoordinate) || !Array.isArray(endCoordinate)) return null;
  const lon1 = finiteNumber(startCoordinate[0]);
  const lat1 = finiteNumber(startCoordinate[1]);
  const lon2 = finiteNumber(endCoordinate[0]);
  const lat2 = finiteNumber(endCoordinate[1]);
  if ([lon1, lat1, lon2, lat2].some((value) => value === null)) return null;

  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitude1 = toRadians(lat1);
  const latitude2 = toRadians(lat2);
  const longitudeDelta = toRadians(lon2 - lon1);
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2)
    - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta);
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return null;
  return normalizeBearing(Math.atan2(y, x) * 180 / Math.PI);
}

function visitCoordinatePairs(value, callback) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    callback([Number(value[0]), Number(value[1])]);
    return;
  }
  value.forEach((item) => visitCoordinatePairs(item, callback));
}

function visitGeometryCoordinates(geometry, callback) {
  if (geometry?.type === "GeometryCollection") {
    (geometry.geometries || []).forEach((item) => visitGeometryCoordinates(item, callback));
    return;
  }
  visitCoordinatePairs(geometry?.coordinates, callback);
}

function geometryLines(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates || [];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).flat();
  if (geometry.type === "LineString") return [geometry.coordinates || []];
  if (geometry.type === "MultiLineString") return geometry.coordinates || [];
  if (geometry.type === "GeometryCollection") return (geometry.geometries || []).flatMap(geometryLines);
  return [];
}

export function getCollectionCameraTarget(collection) {
  const points = [];
  (collection?.features || []).forEach((feature) => {
    visitGeometryCoordinates(feature?.geometry, (coordinate) => points.push(coordinate));
  });
  if (!points.length) return null;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  points.forEach(([longitude, latitude]) => {
    west = Math.min(west, longitude);
    south = Math.min(south, latitude);
    east = Math.max(east, longitude);
    north = Math.max(north, latitude);
  });

  let x = 0;
  let y = 0;
  (collection?.features || []).forEach((feature) => {
    geometryLines(feature?.geometry).forEach((line) => {
      for (let index = 1; index < line.length; index += 1) {
        const start = line[index - 1];
        const end = line[index];
        if (!Array.isArray(start) || !Array.isArray(end)) continue;
        const meanLatitude = ((Number(start[1]) + Number(end[1])) / 2) * Math.PI / 180;
        const eastWest = (Number(end[0]) - Number(start[0])) * Math.cos(meanLatitude);
        const northSouth = Number(end[1]) - Number(start[1]);
        const length = Math.hypot(eastWest, northSouth);
        if (!Number.isFinite(length) || length <= 0) continue;
        const angle = Math.atan2(eastWest, northSouth);
        x += Math.cos(2 * angle) * length;
        y += Math.sin(2 * angle) * length;
      }
    });
  });

  const dominant = Math.abs(x) + Math.abs(y) > 1e-12
    ? normalizeBearing(Math.atan2(y, x) * 90 / Math.PI) % 180
    : 0;

  return {
    center: [(west + east) / 2, (south + north) / 2],
    orientation: dominant
  };
}

function featureNavigationPoint(feature) {
  const properties = feature?.properties || {};
  const longitude = finiteNumber(properties.entrance_lon);
  const latitude = finiteNumber(properties.entrance_lat);
  if (longitude !== null && latitude !== null) return [longitude, latitude];

  const points = [];
  visitGeometryCoordinates(feature?.geometry, (coordinate) => points.push(coordinate));
  if (!points.length) return null;
  const longitudes = points.map((coordinate) => coordinate[0]);
  const latitudes = points.map((coordinate) => coordinate[1]);
  return [
    (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    (Math.min(...latitudes) + Math.max(...latitudes)) / 2
  ];
}

function readScreenAngle() {
  return Number(screen.orientation?.angle ?? window.orientation ?? 0) || 0;
}

function headingFromEvent(event) {
  if (Number.isFinite(event?.webkitCompassHeading)) return normalizeBearing(event.webkitCompassHeading);
  if (!Number.isFinite(event?.alpha)) return null;
  return normalizeBearing(360 - event.alpha + readScreenAngle());
}

export function createCameraController(map, {
  onReset,
  onMessage
} = {}) {
  const toggle = document.querySelector("#view-toggle");
  const menu = document.querySelector("#view-menu");
  const compass = document.querySelector("#compass-control");
  const modeButtons = Array.from(document.querySelectorAll("[data-camera-mode]"));
  let target = null;
  let buildingOrientation = 0;
  let activeMode = "corner";
  let routeCoordinates = [];
  let routeSegmentIndex = 0;
  let orientationEventName = null;
  let smoothedHeading = null;
  let lastAppliedHeading = null;
  let lastHeadingUpdate = 0;

  function message(text) { onMessage?.(text); }
  function setMenuOpen(open) {
    if (!menu || !toggle) return;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }
  function markMode(mode) {
    activeMode = mode;
    modeButtons.forEach((button) => {
      const active = button.dataset.cameraMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });
  }
  function updateCompass() {
    compass?.style.setProperty("--map-bearing", `${-map.getBearing()}deg`);
    compass?.setAttribute("title", `North up · bearing ${Math.round(normalizeBearing(map.getBearing()))}°`);
  }
  function stopHeadingFollow() {
    if (orientationEventName) window.removeEventListener(orientationEventName, handleOrientation, true);
    orientationEventName = null;
    smoothedHeading = null;
    lastAppliedHeading = null;
  }
  function stopFollowModes(nextMode) {
    if (activeMode === "follow") stopHeadingFollow();
    markMode(nextMode);
  }
  function easeCamera(options) {
    map.easeTo({
      ...options,
      duration: options.duration ?? PRESET_DURATION,
      essential: true
    });
  }
  function presetCenter() {
    return target?.center || map.getCenter();
  }
  function applyPreset(mode) {
    stopFollowModes(mode);
    if (mode === "top") {
      easeCamera({ center: presetCenter(), zoom: map.getZoom(), pitch: 0, bearing: map.getBearing(), duration: 700 });
      message("Top view");
    } else if (mode === "corner") {
      easeCamera({ center: presetCenter(), zoom: map.getZoom(), pitch: 58, bearing: shortestBearing(map.getBearing(), buildingOrientation + 38) });
      message("3D corner view");
    } else if (mode === "isometric") {
      easeCamera({ center: presetCenter(), zoom: map.getZoom(), pitch: ISOMETRIC_PITCH, bearing: shortestBearing(map.getBearing(), buildingOrientation + 45) });
      message("Isometric view");
    } else if (mode === "front") {
      easeCamera({ center: presetCenter(), zoom: map.getZoom(), pitch: 72, bearing: shortestBearing(map.getBearing(), buildingOrientation + 90) });
      message("Front angled view");
    } else if (mode === "free") {
      message("Free camera enabled");
    } else if (mode === "north") {
      easeCamera({ pitch: map.getPitch(), bearing: shortestBearing(map.getBearing(), 0), duration: 500 });
      message("North up");
    } else if (mode === "reset") {
      onReset?.();
      markMode("corner");
      message("Default campus view restored");
    }
  }
  function rotateBy(delta) {
    stopFollowModes("free");
    easeCamera({ bearing: map.getBearing() + delta, duration: 350 });
  }
  function tiltBy(delta) {
    stopFollowModes("free");
    const pitch = Math.max(0, Math.min(map.getMaxPitch?.() ?? 78, map.getPitch() + delta));
    easeCamera({ pitch, duration: 350 });
  }
  function currentRouteBearing() {
    const start = routeCoordinates[routeSegmentIndex];
    const end = routeCoordinates[routeSegmentIndex + 1];
    return calculateBearing(start, end);
  }
  function applyRouteBearing() {
    const bearing = currentRouteBearing();
    if (bearing === null) {
      message("Select a source and destination first");
      return false;
    }
    stopFollowModes("route");
    easeCamera({ bearing: shortestBearing(map.getBearing(), bearing), pitch: Math.max(map.getPitch(), 58), duration: 450 });
    message("Route-up view");
    return true;
  }
  function handleOrientation(event) {
    if (activeMode !== "follow") return;
    const heading = headingFromEvent(event);
    if (heading === null) return;
    smoothedHeading = smoothBearing(smoothedHeading, heading);
    const now = performance.now();
    if (lastAppliedHeading !== null && angularDifference(smoothedHeading, lastAppliedHeading) < HEADING_THRESHOLD) return;
    if (now - lastHeadingUpdate < HEADING_MIN_INTERVAL) return;
    lastHeadingUpdate = now;
    lastAppliedHeading = smoothedHeading;
    easeCamera({ bearing: shortestBearing(map.getBearing(), smoothedHeading), duration: 280 });
  }
  async function startHeadingFollow() {
    stopHeadingFollow();
    const OrientationEvent = window.DeviceOrientationEvent;
    if (!OrientationEvent) {
      markMode("free");
      message("Direction sensor is not available on this device");
      return;
    }
    if (typeof OrientationEvent.requestPermission === "function") {
      try {
        const permission = await OrientationEvent.requestPermission();
        if (permission !== "granted") throw new Error("permission denied");
      } catch (_) {
        markMode("free");
        message("Direction permission was not granted");
        return;
      }
    }
    orientationEventName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    markMode("follow");
    window.addEventListener(orientationEventName, handleOrientation, true);
    message("Following device direction");
  }

  toggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    setMenuOpen(menu?.hidden !== false);
  });
  menu?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-camera-mode]");
    if (!button) return;
    const mode = button.dataset.cameraMode;
    setMenuOpen(false);
    if (mode === "follow") startHeadingFollow();
    else if (mode === "route") applyRouteBearing();
    else applyPreset(mode);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".view-control")) setMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenuOpen(false);
  });
  compass?.addEventListener("click", () => applyPreset("north"));
  document.querySelectorAll("[data-camera-rotate]").forEach((button) => button.addEventListener("click", () => rotateBy(Number(button.dataset.cameraRotate) || ROTATE_STEP)));
  document.querySelectorAll("[data-camera-tilt]").forEach((button) => button.addEventListener("click", () => tiltBy(Number(button.dataset.cameraTilt) || TILT_STEP)));
  map.on("rotate", updateCompass);
  updateCompass();

  return {
    applyPreset,
    rotateBy,
    tiltBy,
    activeMode: () => activeMode,
    followDirection: startHeadingFollow,
    routeUp: applyRouteBearing,
    // "View on Map" frames the campus itself; this only marks the default
    // (3D corner) mode in the View menu and stops heading follow.
    markDefaultView: () => { stopFollowModes("corner"); setMenuOpen(false); },
    closeMenu: () => setMenuOpen(false),
    updateTarget(collection) {
      const next = getCollectionCameraTarget(collection);
      if (!next) return;
      target = next;
      buildingOrientation = next.orientation;
    },
    updateRoute(selection) {
      const source = featureNavigationPoint(selection?.source);
      const destination = featureNavigationPoint(selection?.destination);
      routeCoordinates = source && destination ? [source, destination] : [];
      routeSegmentIndex = 0;
      if (activeMode === "route" && routeCoordinates.length > 1) applyRouteBearing();
    },
    setRouteCoordinates(coordinates, currentSegmentIndex = 0) {
      routeCoordinates = Array.isArray(coordinates)
        ? coordinates.filter((coordinate) => Array.isArray(coordinate) && coordinate.length >= 2)
        : [];
      routeSegmentIndex = Math.max(0, Math.min(Number(currentSegmentIndex) || 0, Math.max(0, routeCoordinates.length - 2)));
      if (activeMode === "route") applyRouteBearing();
    },
    destroy() {
      stopHeadingFollow();
      map.off("rotate", updateCompass);
    }
  };
}
