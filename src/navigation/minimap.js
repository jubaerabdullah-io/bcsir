// Circular 2D minimap for first-person walk mode.
//
// A canvas (no second WebGL map, which phones handle poorly): building
// footprints, roads and pathways from the campus data, the drawn route, the
// destination pin and the walker's arrow in the middle. The map turns with the
// walker (heading up); the N mark on the rim shows north. Geometry is turned
// into Path2D objects once, in a local metric frame; a redraw only sets a
// transform and fills or strokes those paths, and happens once per animation
// frame at most, only after a change. Tap or click to enlarge or shrink it;
// the − button folds it to a small round button.
import { createLocalFrame, geometryPolygons } from "./local-frame.js";

const SIZES = { small: 132, large: 264 };
const RADIUS_M = { small: 70, large: 150 }; // metres from the centre to the rim

const COLORS = {
  ground: "#f6f3e4",
  garden: "#d9edc6",
  building: "#dfe3ec",
  buildingEdge: "#b9c0cc",
  road: "#ffffff",
  roadEdge: "#d3d7dd",
  route: "#e53935",
  routeCasing: "#ffffff",
  destination: "#e53935",
  walker: "#1e88e5",
  rim: "rgba(15, 23, 42, 0.18)"
};

function linePaths(collection, toLocal) {
  const paths = [];
  (collection?.features || []).forEach((feature) => {
    const g = feature.geometry;
    const lines = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : [];
    const width = Math.max(1, Number(feature.properties?.render_thickness_m) || 2);
    lines.forEach((line) => {
      if (!Array.isArray(line) || line.length < 2) return;
      const path = new Path2D();
      line.forEach((point, i) => { const [x, y] = toLocal(point); if (i) path.lineTo(x, y); else path.moveTo(x, y); });
      paths.push({ path, width });
    });
  });
  return paths;
}

function polygonPath(collection, toLocal) {
  const path = new Path2D();
  (collection?.features || []).forEach((feature) => geometryPolygons(feature.geometry).forEach((rings) => rings.forEach((ring) => {
    ring.forEach((point, i) => { const [x, y] = toLocal(point); if (i) path.lineTo(x, y); else path.moveTo(x, y); });
    path.closePath();
  })));
  return path;
}

export function createMinimap({ container, onToggle } = {}) {
  if (!container) return null;
  const canvas = container.querySelector("canvas");
  const sizeButton = container.querySelector("[data-minimap-size]");
  const foldButton = container.querySelector("[data-minimap-fold]");
  const ctx = canvas.getContext("2d");
  let frame = null;
  let layers = null; // { garden, buildings, roads[], pathways[] }
  let route = null; // { path, destination: [x, y] }
  let pose = null; // { position: [x, y], heading }
  let size = "small";
  let folded = false;
  let pending = 0;

  function setSize(next) {
    size = next;
    container.dataset.size = size;
    const px = SIZES[size];
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(px * ratio);
    canvas.height = Math.round(px * ratio);
    canvas.style.width = canvas.style.height = `${px}px`;
    sizeButton?.setAttribute("aria-label", size === "small" ? "Enlarge the minimap" : "Shrink the minimap");
    sizeButton?.setAttribute("aria-expanded", String(size === "large"));
    request();
  }

  function setFolded(next) {
    folded = next;
    container.dataset.folded = String(folded);
    foldButton?.setAttribute("aria-label", folded ? "Show the minimap" : "Hide the minimap");
    foldButton?.setAttribute("aria-expanded", String(!folded));
    onToggle?.(!folded);
    request();
  }

  function draw() {
    pending = 0;
    if (!pose || !layers || folded || container.hidden) return;
    const ratio = canvas.width / SIZES[size];
    const px = SIZES[size];
    const c = px / 2;
    const scale = (c - 3) / RADIUS_M[size]; // pixels per metre
    const heading = pose.heading * Math.PI / 180;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, c - 1.5, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = COLORS.ground; ctx.fillRect(0, 0, px, px);
    // Heading up: world -> walker-centred, metres -> pixels, rotated by -heading.
    ctx.translate(c, c);
    ctx.rotate(-heading);
    ctx.scale(scale, -scale);
    ctx.translate(-pose.position[0], -pose.position[1]);
    const pixel = 1 / scale;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.fillStyle = COLORS.garden; ctx.fill(layers.garden, "evenodd");
    for (const { path, width } of [...layers.roads, ...layers.pathways]) { ctx.strokeStyle = COLORS.roadEdge; ctx.lineWidth = Math.max(width, 2.4 * pixel) + 1.4 * pixel; ctx.stroke(path); }
    for (const { path, width } of [...layers.roads, ...layers.pathways]) { ctx.strokeStyle = COLORS.road; ctx.lineWidth = Math.max(width, 2.4 * pixel); ctx.stroke(path); }
    ctx.fillStyle = COLORS.building; ctx.fill(layers.buildings, "evenodd");
    ctx.strokeStyle = COLORS.buildingEdge; ctx.lineWidth = 1 * pixel; ctx.stroke(layers.buildings);
    if (route) {
      ctx.strokeStyle = COLORS.routeCasing; ctx.lineWidth = 6 * pixel; ctx.stroke(route.path);
      ctx.strokeStyle = COLORS.route; ctx.lineWidth = 3.6 * pixel; ctx.stroke(route.path);
    }
    ctx.restore();
    // Destination pin, kept on the rim when it is out of range.
    if (route?.destination) {
      const dx = route.destination[0] - pose.position[0], dy = route.destination[1] - pose.position[1];
      let sx = (dx * Math.cos(heading) - dy * Math.sin(heading)) * scale;
      let sy = -(dx * Math.sin(heading) + dy * Math.cos(heading)) * scale;
      const limit = c - 9;
      const length = Math.hypot(sx, sy);
      if (length > limit) { sx *= limit / length; sy *= limit / length; }
      ctx.save();
      ctx.translate(c + sx, c + sy);
      ctx.fillStyle = COLORS.destination; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -6, 5.5, 0, Math.PI * 2); ctx.moveTo(-4.4, -3); ctx.lineTo(0, 3.5); ctx.lineTo(4.4, -3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(0, -6, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // Walker arrow (always points up) with a soft view cone.
    ctx.save();
    ctx.translate(c, c);
    const cone = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
    cone.addColorStop(0, "rgba(30, 136, 229, 0.28)"); cone.addColorStop(1, "rgba(30, 136, 229, 0)");
    ctx.fillStyle = cone; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 34, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); ctx.closePath(); ctx.fill();
    ctx.fillStyle = COLORS.walker; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // Rim and north mark.
    ctx.beginPath(); ctx.arc(c, c, c - 1.5, 0, Math.PI * 2); ctx.strokeStyle = COLORS.rim; ctx.lineWidth = 3; ctx.stroke();
    const north = -heading - Math.PI / 2;
    const nx = c + Math.cos(north) * (c - 11), ny = c + Math.sin(north) * (c - 11);
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(nx, ny, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = COLORS.rim; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = COLORS.route; ctx.font = "700 10px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("N", nx, ny + 0.5);
  }

  function request() {
    if (!pending) pending = requestAnimationFrame(draw);
  }

  canvas.addEventListener("click", () => setSize(size === "small" ? "large" : "small"));
  sizeButton?.addEventListener("click", () => setSize(size === "small" ? "large" : "small"));
  foldButton?.addEventListener("click", () => setFolded(!folded));
  setSize("small");

  return {
    // Campus geometry, once (and after a live data reload).
    setData({ buildings, garden, roads, pathways }) {
      const first = buildings?.features?.find((feature) => geometryPolygons(feature.geometry).length);
      if (!first) return;
      frame = createLocalFrame(geometryPolygons(first.geometry)[0][0][0]);
      layers = {
        buildings: polygonPath(buildings, frame.toLocal),
        garden: polygonPath(garden, frame.toLocal),
        roads: linePaths(roads, frame.toLocal),
        pathways: linePaths(pathways, frame.toLocal)
      };
      request();
    },
    // coordinates: the drawn route ([[lon, lat], ...]) or null; destination [lon, lat].
    setRoute(coordinates, destination) {
      if (!frame || !Array.isArray(coordinates) || coordinates.length < 2) { route = null; request(); return; }
      const path = new Path2D();
      coordinates.forEach((point, i) => { const [x, y] = frame.toLocal(point); if (i) path.lineTo(x, y); else path.moveTo(x, y); });
      route = { path, destination: destination ? frame.toLocal(destination) : null };
      request();
    },
    // position [lon, lat], heading in degrees.
    update(position, heading) {
      if (!frame || !position) return;
      const next = { position: frame.toLocal(position), heading: Number(heading) || 0 };
      if (pose && Math.abs(pose.position[0] - next.position[0]) < 0.02 && Math.abs(pose.position[1] - next.position[1]) < 0.02 && Math.abs(pose.heading - next.heading) < 0.2) return;
      pose = next;
      request();
    },
    show(visible) {
      container.hidden = !visible;
      if (visible) request();
    },
    isFolded: () => folded,
    size: () => size
  };
}
