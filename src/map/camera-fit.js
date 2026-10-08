// Framing what the camera is focused on (pure, tested with node --test).
//
// MapLibre's fitBounds() frames a box as seen from straight above: in a tilted
// view the near side of what it framed spreads past the bottom of the screen and
// the far side shrinks, and a building turned against north is framed by its
// larger north-up box. fitView() projects the points themselves (with their
// heights) through the same perspective camera as MapLibre (vertical field of
// view, pitch, bearing) and finds the centre and the highest zoom at which all of
// them are inside a rectangle of the screen. chooseBearing() tries the bearings
// along the axes of what is framed and keeps the one that shows it largest: on a
// phone held upright a long building is turned to run up the screen.
import { angleDelta, createLocalFrame, DEG, normalizeDegrees } from "../utils/local-frame.js";

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6371008.8; // MapLibre's earth
const TILE_SIZE = 512;
const ZERO = { top: 0, bottom: 0, left: 0, right: 0 };
const ZOOM_STEPS = 24; // bisection steps: zoom to about 1e-6

// Screen pixels per metre on the ground at a zoom and latitude.
export const pixelsPerMetre = (zoom, latitude) => (TILE_SIZE * 2 ** zoom) / (EARTH_CIRCUMFERENCE_M * Math.cos(latitude * DEG));

const sides = (value) => ({ ...ZERO, ...(value || {}) });

// points  [[lon, lat] or [lon, lat, height in metres], ...]
// width, height        size of the map in CSS pixels
// fov                  vertical field of view in degrees (map.getVerticalFieldOfView())
// mapPadding           the map's own padding (map.getPadding()): its centre is the middle of what it leaves
// padding              edges of the screen to keep clear (panels, controls)
// pitch, bearing       of the camera, in degrees
// Returns { center: [lon, lat], zoom, fits } (fits: false when even minZoom is too
// close), or null when there is nothing to frame.
export function fitView(points, { width, height, fov = 36.87, mapPadding = ZERO, padding = ZERO, pitch = 0, bearing = 0, minZoom = 0, maxZoom = 22 } = {}) {
  const valid = (points || []).filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (!valid.length || !(width > 0) || !(height > 0)) return null;
  const latitude = valid.reduce((sum, point) => sum + point[1], 0) / valid.length;
  const frame = createLocalFrame([valid[0][0], latitude]);
  const b = bearing * DEG;
  const up = [Math.sin(b), Math.cos(b)];
  const right = [Math.cos(b), -Math.sin(b)];
  // Metres along the screen's right and up directions, and the height.
  const local = valid.map((point) => {
    const [x, y] = frame.toLocal(point);
    return [x * right[0] + y * right[1], x * up[0] + y * up[1], Math.max(0, Number(point[2]) || 0)];
  });
  const tilt = Math.min(85, Math.max(0, Number(pitch) || 0)) * DEG;
  const sin = Math.sin(tilt), cos = Math.cos(tilt);
  const d = (0.5 * height) / Math.tan((fov * DEG) / 2); // camera to centre, in pixels (also the focal length)
  const map = sides(mapPadding), box = sides(padding);
  // The rectangle to fit into, from the map's centre point, y upwards.
  const px = map.left + (width - map.left - map.right) / 2;
  const py = map.top + (height - map.top - map.bottom) / 2;
  const rect = { left: box.left - px, right: width - box.right - px, top: py - box.top, bottom: py - (height - box.bottom) };
  const target = [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2];
  const roomX = Math.max(1, rect.right - rect.left), roomY = Math.max(1, rect.top - rect.bottom);

  // Screen box of the points with the camera centred on (cx, cy) metres at k px/m.
  function project(cx, cy, k) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [X, Y, h] of local) {
      const x = (X - cx) * k, y = (Y - cy) * k, z = h * k;
      const depth = d + y * sin - z * cos;
      if (depth < d * 0.05) return null; // behind or beside the camera
      const sx = (d * x) / depth, sy = (d * (y * cos + z * sin)) / depth;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    return { minX, maxX, minY, maxY };
  }
  // Ground point (metres from the centre) seen at a screen point, or null above the horizon.
  function ground(sx, sy, k) {
    const denominator = d * cos - sy * sin;
    if (denominator <= 1e-6) return null;
    const y = (sy * d) / denominator;
    return [(sx * (d + y * sin)) / d / k, y / k];
  }
  const start = local.reduce((acc, [X, Y]) => [Math.min(acc[0], X), Math.max(acc[1], X), Math.min(acc[2], Y), Math.max(acc[3], Y)], [Infinity, -Infinity, Infinity, -Infinity]);
  // The camera centre that puts the middle of the points' screen box in the middle
  // of the rectangle, and whether they fit, at one zoom.
  function at(zoom) {
    const k = pixelsPerMetre(zoom, latitude);
    let cx = (start[0] + start[1]) / 2, cy = (start[2] + start[3]) / 2;
    let screen = null;
    for (let i = 0; i < 10; i += 1) {
      screen = project(cx, cy, k);
      if (!screen) return null;
      const middle = [(screen.minX + screen.maxX) / 2, (screen.minY + screen.maxY) / 2];
      if (Math.hypot(middle[0] - target[0], middle[1] - target[1]) < 0.25) break;
      const seen = ground(middle[0], middle[1], k), wanted = ground(target[0], target[1], k);
      if (!seen || !wanted) return null;
      cx += seen[0] - wanted[0];
      cy += seen[1] - wanted[1];
    }
    screen = project(cx, cy, k);
    if (!screen) return null;
    return { cx, cy, fits: screen.maxX - screen.minX <= roomX + 0.5 && screen.maxY - screen.minY <= roomY + 0.5 };
  }
  const result = (found, zoom, fits) => {
    const [X, Y] = [found.cx, found.cy];
    return { center: frame.toLngLat([X * right[0] + Y * up[0], X * right[1] + Y * up[1]]), zoom, fits };
  };

  const highest = at(maxZoom);
  if (highest?.fits) return result(highest, maxZoom, true);
  let lo = minZoom, hi = maxZoom;
  let best = at(lo);
  if (!best?.fits) return best ? result(best, lo, false) : null;
  for (let i = 0; i < ZOOM_STEPS; i += 1) {
    const middle = (lo + hi) / 2;
    const found = at(middle);
    if (found?.fits) { lo = middle; best = found; } else hi = middle;
  }
  return result(best, lo, true);
}

// The bearing (of `candidates`) at which fitView() shows the points largest; of
// those within `tolerance` zoom levels of the largest, the nearest to `current`.
// `keep` (a bearing, or null) stays unless another shows them `minGain` zoom levels
// larger (a quarter zoom level is a fifth larger).
export function chooseBearing(points, view, { candidates, current = 0, keep = null, minGain = 0.25, tolerance = 0.05 } = {}) {
  const tried = (candidates || []).map((bearing) => ({ bearing: normalizeDegrees(bearing), zoom: fitView(points, { ...view, bearing })?.zoom ?? -Infinity }));
  if (!tried.length) return normalizeDegrees(keep ?? current);
  const largest = Math.max(...tried.map((item) => item.zoom));
  if (keep !== null && keep !== undefined) {
    const kept = fitView(points, { ...view, bearing: keep });
    if (kept && kept.zoom >= largest - minGain) return normalizeDegrees(keep);
  }
  return tried.filter((item) => item.zoom >= largest - tolerance).sort((a, b) => Math.abs(angleDelta(current, a.bearing)) - Math.abs(angleDelta(current, b.bearing)))[0].bearing;
}

// Bearings `offset` degrees from the axes of something whose long axis has
// compass bearing `orientation`: four, a quarter turn apart (`step` 180: two).
export function axisBearings(orientation, offset = 0, step = 90) {
  const bearings = [];
  for (let turn = 0; turn < 360; turn += step) bearings.push(normalizeDegrees(orientation + offset + turn));
  return bearings;
}

// Compass bearing (0 <= bearing < 180) of the long axis of a set of [lon, lat]
// points: their principal axis. 0 for a single point.
export function principalBearing(points) {
  const valid = (points || []).filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (valid.length < 2) return 0;
  const frame = createLocalFrame(valid[0]);
  const local = valid.map(frame.toLocal);
  const mean = local.reduce((sum, [x, y]) => [sum[0] + x / local.length, sum[1] + y / local.length], [0, 0]);
  let xx = 0, yy = 0, xy = 0;
  for (const [x, y] of local) { const dx = x - mean[0], dy = y - mean[1]; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy); // from east, counter-clockwise
  return normalizeDegrees(90 - angle / DEG) % 180;
}

// Points around `center` ([lon, lat]) on a circle of `radiusM` metres: framed, they
// show that much around a place.
export function circlePoints(center, radiusM, steps = 16) {
  const frame = createLocalFrame(center);
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    points.push(frame.toLngLat([Math.cos(angle) * radiusM, Math.sin(angle) * radiusM]));
  }
  return points;
}

// Camera options ({ center, zoom, pitch, bearing }) that frame `points` on this
// map, or null. `bearings`: candidates for chooseBearing() (else `bearing`, or
// the map's); `keepBearing`: true (the map's bearing) or a bearing that stays
// unless a candidate is clearly better. `padding`: { top, bottom, left, right } to keep clear.
export function cameraForPoints(map, points, { pitch = map.getPitch(), bearing = null, bearings = null, keepBearing = false, minGain, padding, minZoom, maxZoom = 22 } = {}) {
  const canvas = map.getCanvas();
  const view = {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    fov: map.getVerticalFieldOfView?.() ?? 36.87,
    mapPadding: map.getPadding?.() || ZERO,
    padding,
    // Pitch is clamped as the map will clamp it (0 in the flat 2D view).
    pitch: Math.max(map.getMinPitch?.() ?? 0, Math.min(map.getMaxPitch?.() ?? 85, pitch)),
    minZoom: minZoom ?? map.getMinZoom(),
    maxZoom: Math.min(maxZoom, map.getMaxZoom())
  };
  const current = map.getBearing();
  // The flat 2D view (?view=2d) stays as it is turned: north up unless the user turned it.
  const flat = (map.getMaxPitch?.() ?? 85) === 0;
  // The bearing is chosen as seen from above (the long side of what is framed along
  // the long side of the screen): tilted, looking along something long squeezes it
  // into the distance, which fits but shows its far end small.
  const chosen = bearings?.length && !flat
    ? chooseBearing(points, { ...view, pitch: 0 }, { candidates: bearings, current, keep: keepBearing === true ? current : Number.isFinite(keepBearing) ? keepBearing : null, ...(minGain === undefined ? {} : { minGain }) })
    : flat ? current : bearing ?? current;
  const fit = fitView(points, { ...view, bearing: chosen });
  if (!fit) return null;
  // The shortest turn from the bearing now.
  return { center: fit.center, zoom: fit.zoom, pitch: view.pitch, bearing: current + angleDelta(current, chosen) };
}
