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

// Start pin -> network path -> destination pin, for a route-service result.
export function routePathCoordinates(result) {
  if (!result?.ok || !result.source?.point || !result.destination?.point) return null;
  const points = [];
  [result.source.point, ...result.coordinates, result.destination.point].forEach((point) => {
    if (!points.length || distanceMeters(points[points.length - 1], point) > 0.01) points.push(point);
  });
  return points.length > 1 ? points : null;
}

export function createRouteWalker(map) {
  const element = document.createElement("div");
  element.className = "route-walker";
  element.innerHTML = `<img class="route-walker-figure" src="${WALKER_IMAGE}" alt="" draggable="false" />`;
  const figure = element.firstElementChild;
  const marker = new maplibregl.Marker({ element, anchor: "bottom", offset: WALKER_OFFSET });
  let path = null; // { points, cumulative, total }
  let visible = true;
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
    if (!path || !visible) { marker.remove(); return; }
    figure.classList.remove("hidden");
    marker.setLngLat(path.points[0]).addTo(map);
    frame = requestAnimationFrame(tick);
  }

  return {
    // coordinates from routePathCoordinates(), or null to stop.
    set(coordinates) { path = coordinates ? measure(coordinates) : null; run(); },
    // The "Calculated route" switch in the layer list.
    setVisible(next) { visible = next; run(); }
  };
}
