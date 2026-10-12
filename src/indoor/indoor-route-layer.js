// The indoor part of a route, drawn on the floor it runs on.
//
// A floor plan lies at its floor's height in the building (indoor-store.js), and a
// MapLibre line can only lie on the ground: drawn as a line layer, the route of an
// upper floor would be seen metres below its corridor, beside it in any tilted view.
// This custom layer draws the same line (white casing, route colour, round joins and
// ends, the same widths in pixels at every zoom; faint and dashed on the floors of an
// open building that are not shown) where the route really is: every point of the
// route is placed at its floor's height with the map's own projection, and the line
// is then drawn across the screen through those points. It is drawn above the floor
// plans and the 3D models, like the line layers it stands in for.
//
// Features: LineString with properties { shown: boolean, elev: metres above the ground }.
import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import { STYLE } from "../core/config.js";
import { acquireRenderer, releaseRenderer } from "../three/three-shared.js";

const LIFT_M = 0.2; // above the floor's slab, on the corridor
// Widths in pixels by zoom, as the line layers had them.
const WIDTHS = { casing: [[16, 5], [19, 9], [22, 14]], line: [[16, 3], [19, 5], [22, 9]] };
const OTHER = { width: 2.5, opacity: 0.35, dash: [1.2 * 2.5, 1.8 * 2.5] }; // floors not shown
const CASING_OPACITY = 0.95;
const DISC_STEPS = 10;

function widthAt(stops, zoom) {
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    const [z0, w0] = stops[i - 1], [z1, w1] = stops[i];
    if (zoom <= z1) return w0 + (w1 - w0) * (zoom - z0) / (z1 - z0);
  }
  return stops.at(-1)[1];
}

export function createIndoorRouteLayer(id) {
  let map = null, gl = null, renderer = null, scene = null, camera = null, mesh = null;
  let lines = []; // [{ shown, points: [MercatorCoordinate] }]
  const casing = new THREE.Color(STYLE.routeCasing), route = new THREE.Color(STYLE.route);

  // The parts of a line in front of the camera, as screen points (CSS pixels).
  function onScreen(points, matrix, width, height, nearest) {
    const clip = points.map((p) => [
      matrix[0] * p.x + matrix[4] * p.y + matrix[8] * p.z + matrix[12],
      matrix[1] * p.x + matrix[5] * p.y + matrix[9] * p.z + matrix[13],
      matrix[3] * p.x + matrix[7] * p.y + matrix[11] * p.z + matrix[15]
    ]);
    const toScreen = (c) => [(c[0] / c[2] * 0.5 + 0.5) * width, (0.5 - c[1] / c[2] * 0.5) * height];
    const cut = (a, b) => { const t = (nearest - a[2]) / (b[2] - a[2]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, nearest]; };
    const parts = [];
    let part = null;
    for (let i = 0; i < clip.length; i += 1) {
      const here = clip[i], before = clip[i - 1];
      const visible = here[2] > nearest;
      if (before && visible !== before[2] > nearest) {
        // The line passes the camera between these two points: it is cut off there.
        const edge = toScreen(cut(before, here));
        if (visible) parts.push(part = [edge]); else { part.push(edge); part = null; }
      }
      if (visible) { if (!part) parts.push(part = []); part.push(toScreen(here)); }
    }
    return parts.filter((item) => item.length > 1);
  }

  // The dashes of a line: pieces `on` pixels long, `off` pixels apart.
  function dashed(points, [on, off]) {
    const pieces = [];
    let piece = [points[0]], left = on, drawing = true;
    for (let i = 1; i < points.length; i += 1) {
      let from = points[i - 1];
      const to = points[i];
      let length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      while (length > left) {
        const t = left / length;
        from = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
        length -= left;
        if (drawing) { piece.push(from); pieces.push(piece); } else piece = [from];
        drawing = !drawing;
        left = drawing ? on : off;
      }
      left -= length;
      if (drawing) piece.push(to);
    }
    if (drawing && piece.length > 1) pieces.push(piece);
    return pieces;
  }

  return {
    id,
    type: "custom",
    renderingMode: "2d",
    onAdd(mapInstance, context) {
      map = mapInstance;
      gl = context;
      renderer = acquireRenderer(map, gl);
      scene = new THREE.Scene();
      camera = new THREE.Camera(); // the line is given in screen coordinates
      const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.frustumCulled = false;
      scene.add(mesh);
    },
    render(_gl, args) {
      const matrix = args?.defaultProjectionData?.mainMatrix;
      if (!renderer || !matrix || !lines.length) return;
      const canvas = map.getCanvas();
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const zoom = map.getZoom();
      // Nothing nearer the camera than this is drawn (a share of the distance to the
      // middle of the view), so a line that runs past the camera is cut off cleanly.
      const centre = MercatorCoordinate.fromLngLat(map.getCenter(), 0);
      const nearest = Math.max(1e-9, (matrix[3] * centre.x + matrix[7] * centre.y + matrix[11] * centre.z + matrix[15]) * 0.01);

      const positions = [], colors = [];
      const vertex = (point, color, opacity) => {
        positions.push(point[0] / width * 2 - 1, 1 - point[1] / height * 2, 0);
        colors.push(color.r, color.g, color.b, opacity);
      };
      const triangle = (a, b, c, color, opacity) => { vertex(a, color, opacity); vertex(b, color, opacity); vertex(c, color, opacity); };
      // A line `thickness` pixels wide through `points`; `round`: round joins and ends.
      const stroke = (points, thickness, color, opacity, round) => {
        const half = thickness / 2;
        for (let i = 1; i < points.length; i += 1) {
          const a = points[i - 1], b = points[i];
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (!(length > 1e-3)) continue;
          const nx = -(b[1] - a[1]) / length * half, ny = (b[0] - a[0]) / length * half;
          const a1 = [a[0] + nx, a[1] + ny], a2 = [a[0] - nx, a[1] - ny], b1 = [b[0] + nx, b[1] + ny], b2 = [b[0] - nx, b[1] - ny];
          triangle(a1, a2, b1, color, opacity);
          triangle(a2, b2, b1, color, opacity);
        }
        if (!round) return;
        for (const point of points) {
          for (let k = 0; k < DISC_STEPS; k += 1) {
            const u = k / DISC_STEPS * Math.PI * 2, v = (k + 1) / DISC_STEPS * Math.PI * 2;
            triangle(point, [point[0] + Math.cos(u) * half, point[1] + Math.sin(u) * half], [point[0] + Math.cos(v) * half, point[1] + Math.sin(v) * half], color, opacity);
          }
        }
      };

      const drawn = lines.map((line) => ({ shown: line.shown, parts: onScreen(line.points, matrix, width, height, nearest) }));
      // Bottom to top: the other floors' legs, the casing, the line.
      for (const line of drawn) if (!line.shown) for (const part of line.parts) for (const dash of dashed(part, OTHER.dash)) stroke(dash, OTHER.width, route, OTHER.opacity, false);
      for (const line of drawn) if (line.shown) for (const part of line.parts) stroke(part, widthAt(WIDTHS.casing, zoom), casing, CASING_OPACITY, true);
      for (const line of drawn) if (line.shown) for (const part of line.parts) stroke(part, widthAt(WIDTHS.line, zoom), route, 1, true);
      if (!positions.length) return;

      const geometry = mesh.geometry;
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
      renderer.resetState();
      renderer.render(scene, camera);
      renderer.resetState();
      // The attributes are made anew every frame: the old ones are released.
      geometry.dispose();
    },
    onRemove() {
      mesh?.geometry.dispose();
      mesh?.material.dispose();
      releaseRenderer(gl);
      renderer = scene = camera = mesh = null;
    },
    // collection: the route's legs (see the top of this file), or null for none.
    setData(collection) {
      lines = (collection?.features || [])
        .filter((feature) => feature.geometry?.type === "LineString" && feature.geometry.coordinates.length > 1)
        .map((feature) => ({
          shown: feature.properties?.shown === true,
          points: feature.geometry.coordinates.map((point) => MercatorCoordinate.fromLngLat([point[0], point[1]], (Number(feature.properties?.elev) || 0) + LIFT_M))
        }));
      map?.triggerRepaint();
    }
  };
}
