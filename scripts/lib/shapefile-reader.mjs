// Minimal, dependency-free ESRI Shapefile reader used to derive GeoJSON copies
// of ShapefileFolder/Garden and ShapefileFolder/TreeLine for MapLibre.
//
// It only reads. Coordinates are copied exactly as stored in the .shp file
// (IEEE-754 doubles); no reprojection, rounding or simplification is applied.
// Both BCSIR shapefiles are already WGS 84 geographic (see their .prj files),
// which is the coordinate system MapLibre expects for GeoJSON.
import { readFile } from "node:fs/promises";

const SHAPE_TYPES = { 0: "Null", 1: "Point", 3: "PolyLine", 5: "Polygon", 8: "MultiPoint" };

function ringSignedArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    area += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return area / 2; // > 0 when clockwise in lon/lat axes
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function readParts(view, offset, numParts, numPoints) {
  const partStarts = [];
  for (let i = 0; i < numParts; i += 1) partStarts.push(view.getInt32(offset + i * 4, true));
  const pointsOffset = offset + numParts * 4;
  const parts = [];
  for (let p = 0; p < numParts; p += 1) {
    const start = partStarts[p];
    const end = p + 1 < numParts ? partStarts[p + 1] : numPoints;
    const coordinates = [];
    for (let i = start; i < end; i += 1) {
      const at = pointsOffset + i * 16;
      coordinates.push([view.getFloat64(at, true), view.getFloat64(at + 8, true)]);
    }
    parts.push(coordinates);
  }
  return parts;
}

// ESRI polygons: outer rings are clockwise, holes counter-clockwise.
function polygonGeometry(rings) {
  const outers = [];
  const holes = [];
  for (const ring of rings) (ringSignedArea(ring) >= 0 ? outers : holes).push(ring);
  if (!outers.length) return { type: "Polygon", coordinates: rings };
  const polygons = outers.map((outer) => [outer]);
  for (const hole of holes) {
    const owner = polygons.find(([outer]) => pointInRing(hole[0], outer)) || polygons[0];
    owner.push(hole);
  }
  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };
}

export function parseShp(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getInt32(0, false) !== 9994) throw new Error("Not an ESRI shapefile (bad file code).");
  const fileLength = view.getInt32(24, false) * 2;
  const shapeType = view.getInt32(32, true);
  const bbox = [8, 16, 24, 32].map((o) => view.getFloat64(36 + o - 8, true));
  const geometries = [];
  let offset = 100;
  while (offset < Math.min(fileLength, buffer.byteLength)) {
    const contentLength = view.getInt32(offset + 4, false) * 2;
    const content = offset + 8;
    const type = view.getInt32(content, true);
    if (type === 0) {
      geometries.push(null);
    } else if (type === 3 || type === 5) {
      const numParts = view.getInt32(content + 36, true);
      const numPoints = view.getInt32(content + 40, true);
      const parts = readParts(view, content + 44, numParts, numPoints);
      geometries.push(type === 3
        ? (parts.length === 1 ? { type: "LineString", coordinates: parts[0] } : { type: "MultiLineString", coordinates: parts })
        : polygonGeometry(parts));
    } else if (type === 1) {
      geometries.push({ type: "Point", coordinates: [view.getFloat64(content + 4, true), view.getFloat64(content + 12, true)] });
    } else {
      throw new Error(`Unsupported shape type ${SHAPE_TYPES[type] || type}.`);
    }
    offset = content + contentLength;
  }
  return { shapeType: SHAPE_TYPES[shapeType] || String(shapeType), bbox, geometries };
}

export function parseDbf(buffer, encoding = "utf-8") {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const decoder = new TextDecoder(encoding);
  const fields = [];
  for (let at = 32; at < headerLength - 1 && buffer[at] !== 0x0d; at += 32) {
    const name = decoder.decode(buffer.subarray(at, at + 11)).replace(/\0.*$/s, "");
    fields.push({ name, type: String.fromCharCode(buffer[at + 11]), length: buffer[at + 16], decimals: buffer[at + 17] });
  }
  const records = [];
  for (let r = 0; r < recordCount; r += 1) {
    const start = headerLength + r * recordLength;
    if (buffer[start] === 0x2a) { records.push(null); continue; } // deleted record
    let cursor = start + 1;
    const properties = {};
    for (const field of fields) {
      const raw = decoder.decode(buffer.subarray(cursor, cursor + field.length)).trim();
      cursor += field.length;
      if (field.type === "N" || field.type === "F") properties[field.name] = raw === "" ? null : Number(raw);
      else if (field.type === "L") properties[field.name] = /^[YyTt]$/.test(raw) ? true : /^[NnFf]$/.test(raw) ? false : null;
      else properties[field.name] = raw === "" ? null : raw;
    }
    records.push(properties);
  }
  return { fields, records };
}

export async function readShapefile(basePath) {
  const [shp, dbf, cpg, prj] = await Promise.all([
    readFile(`${basePath}.shp`),
    readFile(`${basePath}.dbf`),
    readFile(`${basePath}.cpg`, "utf8").catch(() => "utf-8"),
    readFile(`${basePath}.prj`, "utf8").catch(() => "")
  ]);
  const { shapeType, bbox, geometries } = parseShp(shp);
  const { fields, records } = parseDbf(dbf, cpg.trim().toLowerCase() || "utf-8");
  if (records.length !== geometries.length) {
    throw new Error(`${basePath}: ${geometries.length} shapes but ${records.length} attribute records.`);
  }
  const features = geometries.map((geometry, index) => ({ type: "Feature", properties: records[index] || {}, geometry }));
  return { shapeType, bbox, fields, prj: prj.trim(), features };
}
