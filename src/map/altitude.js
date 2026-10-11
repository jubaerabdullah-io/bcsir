// Where a point at a height above the ground lands on the screen.
//
// MapLibre projects everything it draws in 3D, but its HTML markers stand on the
// ground: Marker.setLngLat() knows no height. A pin that belongs on a roof or on
// an upper floor therefore has to be moved up the screen by hand, and by how much
// depends on the camera (a pitched view pushes a roof further up the screen than a
// view from above, and further the nearer the building is).
//
// This module answers that: project(lngLat, metres) gives the screen point of a
// position at that height. It reads the map's own projection matrix from an empty
// custom layer, the same matrix the 3D layers draw with (three/three-shared.js), so
// a pin raised this way sits exactly on the model it belongs to. Before the first
// frame is drawn, and in a view where the matrix is not available, it falls back to
// the ground point, so a marker is never lost.
//
// elevate(marker, lngLat, metres) applies that to a MapLibre Marker as its pixel
// offset, and keeps it right while the camera moves.
import { MercatorCoordinate } from "maplibre-gl";

const LAYER_ID = "altitude-probe";
const probes = new WeakMap(); // map -> { matrix, listeners }

// An empty custom layer: it draws nothing and only keeps the frame's matrix.
function probeFor(map) {
  let probe = probes.get(map);
  if (probe) return probe;
  probe = { matrix: null, listeners: new Set() };
  probes.set(map, probe);
  const layer = {
    id: LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd() {},
    render(_gl, args) {
      const matrix = args?.defaultProjectionData?.mainMatrix;
      if (!matrix) return;
      probe.matrix = matrix;
      probe.listeners.forEach((listener) => listener());
    }
  };
  const add = () => { if (!map.getLayer(LAYER_ID)) map.addLayer(layer); };
  if (map.isStyleLoaded()) add(); else map.once("load", add);
  map.on("styledata", add);
  return probe;
}

// Screen point ({ x, y } in CSS pixels) of `lngLat` at `metres` above the ground,
// or the ground point when the map has not drawn a frame yet.
export function projectAltitude(map, lngLat, metres = 0) {
  const ground = map.project(lngLat);
  const matrix = probeFor(map).matrix;
  if (!matrix || !metres) return ground;
  const point = MercatorCoordinate.fromLngLat(lngLat, metres);
  const [x, y, z] = [point.x, point.y, point.z];
  const clip = [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    0,
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15]
  ];
  if (!(clip[3] > 0)) return ground; // behind the camera
  const canvas = map.getCanvas();
  return { x: (clip[0] / clip[3] * 0.5 + 0.5) * canvas.clientWidth, y: (0.5 - clip[1] / clip[3] * 0.5) * canvas.clientHeight };
}

// How far up the screen a point at `metres` above `lngLat` sits, in pixels
// ([x, y], a Marker offset). [0, 0] at ground level or before the first frame.
export function altitudeOffset(map, lngLat, metres = 0) {
  if (!metres) return [0, 0];
  const probe = probeFor(map);
  if (!probe.matrix) return [0, 0];
  const ground = map.project(lngLat);
  const raised = projectAltitude(map, lngLat, metres);
  return [raised.x - ground.x, raised.y - ground.y];
}

// Keeps a MapLibre Marker at `metres` above its position: it is offset up the
// screen by as much as the camera makes that height, and follows the camera.
// Returns a function that puts the marker back on the ground and stops following.
export function elevateMarker(map, marker, metres) {
  const probe = probeFor(map);
  const base = marker.getOffset?.() || { x: 0, y: 0 };
  const origin = [base.x ?? base[0] ?? 0, base.y ?? base[1] ?? 0];
  let applied = null;
  const apply = () => {
    const position = marker.getLngLat?.();
    if (!position) return;
    const [dx, dy] = altitudeOffset(map, position, metres);
    const next = [origin[0] + dx, origin[1] + dy];
    if (applied && Math.abs(applied[0] - next[0]) < 0.5 && Math.abs(applied[1] - next[1]) < 0.5) return;
    applied = next;
    marker.setOffset(next);
  };
  probe.listeners.add(apply);
  apply();
  map.triggerRepaint();
  return () => {
    probe.listeners.delete(apply);
    marker.setOffset(origin);
  };
}
