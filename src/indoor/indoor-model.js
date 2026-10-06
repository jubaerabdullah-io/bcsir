// One floor, prepared from its GeoJSON files (pure, tested with node --test).
//
// buildLevelModel() takes the parsed files of a floor folder and returns what the
// map draws (render features tagged with `kind`), what can be selected (rooms and
// points with stable ids), and what routing needs (the walking grid and the cell
// each room or point is reached from). The source files are only read.
import { labelAnchor, wallLineToPolygon } from "../utils/geo-utils.js";
import { geometryLines, geometryPolygons } from "../utils/local-frame.js";
import { parseColor, parseNumber } from "../data/visual-properties.js";
import { createNavGrid } from "./nav-grid.js";
import { classLabel, featureKeys, featureName, firstProperty, isConnectorClass, placeUid, poiClass, unitClass } from "./levels.js";

// Look of a floor plan. Heights are drawn heights in metres: the open floor is shown
// at ground level, so they only need to read well, not match the building.
export const INDOOR_STYLE = {
  floor: "#eef1f4",
  corridor: "#ffffff",
  wall: "#8d99a8",
  wallHeightM: 1.5,
  wallThicknessM: 0.18,
  unitHeightM: 0.35,
  selected: "#fbbf24",
  hover: "#fde68a",
  routeSource: "#7fb2f0",
  routeDestination: "#f28b82"
};

// Fill colour of a room by its class; a room's own "color" property replaces it.
export const UNIT_COLORS = {
  room: "#e3e8ef",
  office: "#d6e4f5",
  shop: "#fde3c0",
  store: "#e9e2d6",
  storage: "#e9e2d6",
  meeting: "#e0d9f4",
  lab: "#d3eedf",
  toilet: "#cfe9f3",
  food: "#fbdcc9",
  prayer: "#d9efcf",
  reception: "#fdeeb8",
  production: "#f1dfc6",
  loading: "#dcdfe4",
  "first-aid": "#fbd3d3",
  classroom: "#dcebd0",
  hall: "#e6dff2"
};
const DEFAULT_UNIT_COLOR = "#e3e8ef";

const featuresOf = (collection) => (collection?.type === "FeatureCollection" && Array.isArray(collection.features) ? collection.features : []);
const validRing = (ring) => Array.isArray(ring) && ring.length >= 4 && ring.every((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
const cleanPolygons = (geometry) => geometryPolygons(geometry).filter((rings) => validRing(rings?.[0])).map((rings) => rings.filter(validRing).map((ring) => ring.map((point) => [point[0], point[1]])));

// Distance in metres from a point to the outline of a polygon (all rings).
function distanceToOutline(point, rings) {
  const k = Math.cos(point[1] * Math.PI / 180) * 111320;
  const local = (p) => [(p[0] - point[0]) * k, (p[1] - point[1]) * 110574];
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [ax, ay] = local(ring[j]), [bx, by] = local(ring[i]);
      const dx = bx - ax, dy = by - ay;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, (-ax * dx - ay * dy) / length)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

// files: { level, corridor: [], units: [{ file, class, data }], walls: [], pois: [{ file, data }], doors: [] }
//        (GeoJSON FeatureCollections; `level` may be null)
// footprint: geometry used as the floor outline when the floor has no level file.
export function buildLevelModel({ buildingKey, level, files, footprint = null, cellSize = 0.5 }) {
  const problems = [];
  const render = [];
  const labels = [];
  const where = { building: buildingKey, level: level.id };

  // ---- Floor outline ---------------------------------------------------------------
  const outlineFeatures = featuresOf(files.level);
  let floor = outlineFeatures.flatMap((feature) => cleanPolygons(feature.geometry));
  if (!floor.length && footprint) floor = cleanPolygons(footprint);
  floor.forEach((rings, index) => render.push({ type: "Feature", properties: { kind: "floor", uid: `${buildingKey}/${level.id}/floor/${index + 1}`, ...where }, geometry: { type: "Polygon", coordinates: rings } }));

  // ---- Corridors (walkable) --------------------------------------------------------
  const corridors = (files.corridor || []).flatMap((collection) => featuresOf(collection)).flatMap((feature) => cleanPolygons(feature.geometry));
  corridors.forEach((rings, index) => render.push({ type: "Feature", properties: { kind: "corridor", uid: `${buildingKey}/${level.id}/corridor/${index + 1}`, ...where }, geometry: { type: "Polygon", coordinates: rings } }));

  // ---- Rooms ------------------------------------------------------------------------
  const units = [];
  for (const { file, class: fileClass, data } of files.units || []) {
    const features = featuresOf(data);
    const keys = featureKeys(features);
    features.forEach((feature, index) => {
      const polygons = cleanPolygons(feature.geometry);
      if (!polygons.length) { problems.push(`${file} feature ${keys[index]}: not a polygon`); return; }
      const properties = feature.properties || {};
      const uid = placeUid(buildingKey, level.id, file, keys[index]);
      const type = unitClass(properties, fileClass);
      const name = featureName(properties);
      const color = parseColor(properties.color) || UNIT_COLORS[type] || DEFAULT_UNIT_COLOR;
      const point = labelAnchor({ geometry: { type: "Polygon", coordinates: polygons.reduce((best, rings) => (rings[0].length > best[0].length ? rings : best), polygons[0]) } });
      const height = parseNumber(properties.height_m);
      const unit = { uid, kind: "unit", name, class: type, classLabel: classLabel(type), color, point, polygons, properties, ...where };
      units.push(unit);
      polygons.forEach((rings, part) => render.push({ type: "Feature", properties: { kind: "unit", uid, part, name, class: type, color, height: height > 0 ? height : INDOOR_STYLE.unitHeightM, ...where }, geometry: { type: "Polygon", coordinates: rings } }));
      if (name && point) labels.push({ type: "Feature", properties: { kind: "unit-label", uid, name, class: type, ...where }, geometry: { type: "Point", coordinates: point } });
    });
  }

  // ---- Walls ------------------------------------------------------------------------
  (files.walls || []).flatMap((collection) => featuresOf(collection)).forEach((feature, index) => {
    const properties = feature.properties || {};
    const thickness = parseNumber(properties.thickness_m) > 0 ? parseNumber(properties.thickness_m) : INDOOR_STYLE.wallThicknessM;
    const height = parseNumber(properties.height_m) > 0 ? parseNumber(properties.height_m) : INDOOR_STYLE.wallHeightM;
    const color = parseColor(properties.color) || INDOOR_STYLE.wall;
    const strips = [
      ...geometryLines(feature.geometry).map((path) => wallLineToPolygon(path, thickness, "center")).filter(Boolean).map((polygon) => polygon.coordinates),
      ...cleanPolygons(feature.geometry)
    ];
    strips.forEach((rings, part) => render.push({ type: "Feature", properties: { kind: "wall", uid: `${buildingKey}/${level.id}/wall/${index + 1}.${part}`, height, color, ...where }, geometry: { type: "Polygon", coordinates: rings } }));
  });

  // ---- Points ------------------------------------------------------------------------
  const pois = [];
  for (const { file, data } of files.pois || []) {
    const features = featuresOf(data);
    const keys = featureKeys(features);
    features.forEach((feature, index) => {
      const coordinates = feature.geometry?.type === "Point" ? feature.geometry.coordinates : feature.geometry?.type === "MultiPoint" ? feature.geometry.coordinates[0] : null;
      if (!coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) { problems.push(`${file} feature ${keys[index]}: not a point`); return; }
      const properties = feature.properties || {};
      const type = poiClass(properties);
      const uid = placeUid(buildingKey, level.id, file, keys[index]);
      const name = featureName(properties) || classLabel(type);
      const poi = { uid, kind: "poi", name, class: type, classLabel: classLabel(type), point: [coordinates[0], coordinates[1]], connector: isConnectorClass(type) ? type : null, connector_id: firstProperty(properties, ["connector_id", "connects", "shaft", "shaft_id"]) ?? null, properties, ...where };
      pois.push(poi);
      labels.push({ type: "Feature", properties: { kind: "poi", uid, name, class: type, icon: type, ...where }, geometry: { type: "Point", coordinates: poi.point } });
    });
  }

  const doors = (files.doors || []).flatMap((collection) => featuresOf(collection)).flatMap((feature) => {
    const geometry = feature.geometry;
    if (geometry?.type === "Point") return [geometry.coordinates.slice(0, 2)];
    if (geometry?.type === "MultiPoint") return geometry.coordinates.map((point) => point.slice(0, 2));
    // A door drawn as a line across the opening: its middle.
    return geometryLines(geometry).filter((line) => line.length >= 2).map((line) => [(line[0][0] + line.at(-1)[0]) / 2, (line[0][1] + line.at(-1)[1]) / 2]);
  });

  // ---- Walking grid (made when a route first needs it) -------------------------------
  // With corridors: the corridors. Without: the whole floor except the rooms.
  let grid;
  function getGrid() {
    if (grid === undefined) {
      grid = corridors.length
        ? createNavGrid({ walkable: corridors, cellSize })
        : createNavGrid({ walkable: floor, blocked: units.flatMap((unit) => unit.polygons), cellSize });
    }
    return grid;
  }

  const byUid = new Map([...units, ...pois].map((place) => [place.uid, place]));

  // Routing anchor of a room or point: { level, point, cell, label, via } or null
  // when it cannot be reached from the walkable area.
  function anchorFor(uid) {
    const place = byUid.get(uid);
    const navGrid = getGrid();
    if (!place || !navGrid) return null;
    if (place.kind === "poi") {
      const snapped = navGrid.nearestCell(place.point, 6);
      return snapped ? { level: level.id, point: place.point, cell: snapped.cell, label: place.name } : null;
    }
    // A door of this room (a door point on or near its outline), else the place
    // where the room's outline is nearest the corridor.
    const rings = place.polygons.flat();
    const door = doors.map((point) => ({ point, d: distanceToOutline(point, rings) })).filter((item) => item.d <= 1.2).sort((p, q) => p.d - q.d)[0];
    if (door) {
      const snapped = navGrid.nearestCell(door.point, 3);
      if (snapped) return { level: level.id, point: place.point, cell: snapped.cell, label: place.name || place.classLabel, via: door.point };
    }
    const reached = navGrid.nearestCellToPolygon(rings, place.point, 2.5);
    return reached ? { level: level.id, point: place.point, cell: reached.cell, label: place.name || place.classLabel } : null;
  }

  // Routing anchor of any position on this floor (an entrance, a point on the map).
  function anchorAt(point, label, maxM = 30) {
    const snapped = getGrid()?.nearestCell(point, maxM);
    return snapped ? { level: level.id, point, cell: snapped.cell, label, snapDistanceM: snapped.distanceM } : null;
  }

  return {
    id: level.id,
    buildingKey,
    level,
    floor,
    corridors,
    units,
    pois,
    doors,
    place: (uid) => byUid.get(uid) || null,
    render: { type: "FeatureCollection", features: render },
    labels: { type: "FeatureCollection", features: labels },
    get grid() { return getGrid(); },
    anchorFor,
    anchorAt,
    problems
  };
}
