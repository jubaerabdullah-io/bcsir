// Walking figure that moves along the calculated route, from the start pin to
// the destination pin, and then starts again. Like the pins it is an HTML
// marker, so it is drawn above the 3D buildings. Display only: the route
// itself comes from routing/route-service.js and is not changed.
import * as maplibregl from "maplibre-gl";
import { distanceMeters } from "./geo-utils.js";
import { publicAssetUrl } from "./paths.js";

const METRES_PER_SECOND = 20; // animation speed along the route
const MIN_DURATION_MS = 5000;
const MAX_DURATION_MS = 24000;
const PAUSE_MS = 700; // hidden at the destination before starting again
// Person figure standing on its ground shadow (public/route-walker.png). The
// shadow's centre is 2 px above the bottom of the image, so the marker is
// anchored at the bottom and moved down 2 px to stand on the route line.
const WALKER_IMAGE = publicAssetUrl("route-walker.png");
const WALKER_OFFSET = [0, 2];
// Drawn figure used when the PNG cannot be loaded (for example a deployment
// without the file), so the map never shows a broken-image icon.
const WALKER_FALLBACK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><ellipse cx="22" cy="41" rx="8" ry="2.2" fill="rgba(15,23,42,0.28)"/><circle cx="23.5" cy="8" r="4" fill="#1e88e5"/><path d="M20.4 14.2 16 38h3.6l3-13.3 3.5 3.3V38h3.4V25.4l-3.5-3.3 1-5c1.6 2.3 4.4 3.9 7.5 3.9v-3.4c-3.1 0-5.8-1.6-7.1-4l-1.7-2.6a3.2 3.2 0 0 0-3.9-1.3L13.6 13v7.7H17v-5.4Z" fill="#1e88e5" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>')}`;

// Start pin -> network path -> destination pin, for a route-service result.
// Access legs corrected around buildings (navigation/route-detour.js) are used
// when present.
export function routePathCoordinates(result) {
  if (!result?.ok || !result.source?.point || !result.destination?.point) return null;
  const points = [];
  const start = result.source.accessPath?.length ? result.source.accessPath : [result.source.point];
  const end = result.destination.accessPath?.length ? [...result.destination.accessPath].reverse() : [result.destination.point];
  [...start, ...result.coordinates, ...end].forEach((point) => {
    if (!points.length || distanceMeters(points[points.length - 1], point) > 0.01) points.push(point);
  });
  return points.length > 1 ? points : null;
}

export function createRouteWalker(map) {
  const element = document.createElement("div");
  element.className = "route-walker";
  element.innerHTML = `<img class="route-walker-figure" src="${WALKER_IMAGE}" alt="" draggable="false" />`;
  const figure = element.firstElementChild;
  figure.addEventListener("error", () => { if (figure.src !== WALKER_FALLBACK) figure.src = WALKER_FALLBACK; });
  const marker = new maplibregl.Marker({ element, anchor: "bottom", offset: WALKER_OFFSET });
  let path = null; // { points, cumulative, total }
  let visible = true;
  let suppressed = false; // hidden while live navigation or walk mode shows the user's own position
  let frame = 0;
  let startTime = 0;

  function measure(points) {
    const cumulative = [0];
    for (let i = 1; i < points.length; i += 1) cumulative.push(cumulative[i - 1] + distanceMeters(points[i - 1], points[i]));
    const total = cumulative[cumulative.length - 1];
    return total >= 1 ? { points, cumulative, total } : null;
  }

  // Position `distance` metres along the path.
  function locate(distance) {
    const { points, cumulative } = path;
    let i = 1;
    while (i < points.length - 1 && cumulative[i] < distance) i += 1;
    const length = cumulative[i] - cumulative[i - 1];
    const t = length > 0 ? Math.min(1, Math.max(0, (distance - cumulative[i - 1]) / length)) : 0;
    const [a, b] = [points[i - 1], points[i]];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  function tick(time) {
    if (!startTime) startTime = time;
    const duration = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, path.total / METRES_PER_SECOND * 1000));
    const elapsed = (time - startTime) % (duration + PAUSE_MS);
    marker.setLngLat(locate(Math.min(1, elapsed / duration) * path.total));
    figure.classList.toggle("hidden", elapsed > duration);
    frame = requestAnimationFrame(tick);
  }

  function run() {
    cancelAnimationFrame(frame);
    frame = 0;
    startTime = 0;
    if (!path || !visible || suppressed) { marker.remove(); return; }
    figure.classList.remove("hidden");
    marker.setLngLat(path.points[0]).addTo(map);
    frame = requestAnimationFrame(tick);
  }

  return {
    // coordinates from routePathCoordinates(), or null to stop.
    set(coordinates) { path = coordinates ? measure(coordinates) : null; run(); },
    // The "Calculated route" switch in the layer list.
    setVisible(next) { visible = next; run(); },
    // Hidden (and its animation stopped) without changing the layer switch.
    setSuppressed(next) { if (suppressed !== Boolean(next)) { suppressed = Boolean(next); run(); } }
  };
}
