// "gallery" style: the Pilot Plant & Process Development Centre (reference photo
// backup/models/source/ppdc/photo-1.png). Built along the footprint polygon's own
// edges (any shape, not only rectangles): upper floors with open corridor galleries
// (railing parapets on slab bands, columns every bay, the corridor wall with
// windows and doors behind), a ground floor on a plinth, a flat roof behind a
// parapet with solar panels and a stair room or an open shed.
// Edges shared with another modelled building part (the PPDC ring is two
// BuildingBoundary features) get no wall; edges facing the building's own
// courtyard get the plainer courtyard facade; the entrance edge gets the door,
// signboard, steps and planters.
import { concrete, mix, rng, scale, valueNoise } from "./atlas.mjs";
import { mul } from "./mesh.mjs";
import { inside, interiorPoint, nearestEdge, polygonEdges, segmentDistance, worldBearing } from "./polygon.mjs";
import { paintNameSign } from "./style-screen.mjs";

export const regions = {
  cellA: [0, 0, 256, 288],
  cellB: [256, 0, 256, 288],
  ground: [512, 0, 256, 320],
  door: [768, 0, 256, 320],
  inner: [0, 288, 256, 288],
  innerGround: [256, 288, 256, 320],
  rail: [512, 320, 256, 64],
  solar: [768, 320, 128, 128],
  roof: [512, 384, 256, 256],
  sign: [0, 640, 1024, 128],
  concrete: [0, 784, 64, 64],
  dark: [64, 784, 64, 64],
  brick: [128, 784, 64, 64],
  red: [192, 784, 64, 64],
  cream: [256, 784, 64, 64],
  metal: [320, 784, 64, 64],
  roofbox: [384, 784, 64, 64]
};
const SWATCH = { concrete: [212, 210, 202], dark: [70, 70, 68], brick: [192, 124, 82], red: [188, 62, 56], cream: [214, 209, 196], metal: [122, 124, 128], roofbox: [200, 197, 188] };
export const swatches = Object.keys(SWATCH);

// ---- Texture -------------------------------------------------------------------------
// Upper-floor bay seen through the gallery: corridor wall with a window (A) or a
// door and a window (B), darker towards the corridor ceiling.
function paintCell(atlas, region, door, seed) {
  const [, , w, h] = region;
  atlas.paint(region, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete([140, 138, 131], x, y, seed, 4, 8);
    if (v < 0.31) c = concrete([122, 120, 114], x, y, seed + 1, 4, 6); // behind the railing
    if (v > 0.86) c = mix(c, [86, 86, 84], (v - 0.86) / 0.14); // ceiling shadow
    const openings = door ? [[0.12, 0.4, 0.31, 0.84, "door"], [0.55, 0.88, 0.4, 0.78, "window"]] : [[0.24, 0.76, 0.38, 0.78, "window"]];
    for (const [u0, u1, v0, v1, kind] of openings) {
      if (u < u0 || u > u1 || v < v0 || v > v1) continue;
      const fu = (u - u0) / (u1 - u0), fv = (v - v0) / (v1 - v0);
      const frame = fu < 0.05 || fu > 0.95 || fv < 0.05 || fv > 0.95;
      if (kind === "door") c = frame ? [150, 146, 138] : concrete([72, 60, 50], x, y, seed + 2, 3, 3);
      else c = frame ? [156, 154, 148] : (Math.abs((fu * 6) % 1 - 0.5) > 0.44 || Math.abs((fv * 5) % 1 - 0.5) > 0.44 ? [96, 96, 94] : [46, 50, 54]);
    }
    return c;
  });
}

function paintGround(atlas, region, { door = false, cream = false, seed = 31 } = {}) {
  const [, , w, h] = region;
  atlas.paint(region, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete(cream ? [210, 206, 194] : [200, 198, 190], x, y, seed, 4, 8);
    if (v < 0.16) c = concrete([168, 166, 158], x, y, seed + 1, 4, 6);
    if (v > 0.92) c = scale(c, 0.8);
    if (door) {
      if (u > 0.14 && u < 0.86 && v > 0.16 && v < 0.8) {
        const fu = (u - 0.14) / 0.72, fv = (v - 0.16) / 0.64;
        c = fu < 0.03 || fu > 0.97 || fv > 0.97 || Math.abs(fu - 0.5) < 0.012 || Math.abs(fv - 0.78) < 0.01 ? [120, 116, 108] : mix([30, 32, 36], [52, 56, 62], fv);
      }
    } else if (u > 0.2 && u < 0.8 && v > 0.28 && v < 0.72) {
      const fu = (u - 0.2) / 0.6, fv = (v - 0.28) / 0.44;
      c = fu < 0.04 || fu > 0.96 || fv < 0.04 || fv > 0.96 ? [150, 148, 142] : (Math.abs((fu * 7) % 1 - 0.5) > 0.42 ? [100, 100, 98] : [48, 52, 56]);
    }
    return c;
  });
}

function paintInner(atlas) {
  const [, , w, h] = regions.inner;
  atlas.paint(regions.inner, (x, y) => {
    const u = x / w, v = 1 - y / h;
    let c = concrete([212, 208, 197], x, y, 41, 4, 6);
    if (v < 0.08) c = [176, 172, 162];
    if (u > 0.18 && u < 0.62 && v > 0.36 && v < 0.76) {
      const fu = (u - 0.18) / 0.44, fv = (v - 0.36) / 0.4;
      c = fu < 0.05 || fu > 0.95 || fv < 0.06 || fv > 0.94 || Math.abs(fu - 0.5) < 0.03 ? [150, 150, 146] : mix([48, 52, 56], [70, 76, 82], fv);
    }
    if (u > 0.7 && u < 0.88 && v > 0.62 && v < 0.74) c = u > 0.86 || v < 0.64 ? [180, 180, 176] : [224, 224, 220]; // AC unit
    return c;
  });
}

function paintRail(atlas) {
  const [, , , h] = regions.rail;
  atlas.paint(regions.rail, (x, y) => {
    const v = y / h;
    let c = concrete([214, 212, 204], x, y, 51, 4, 8);
    if ([0.34, 0.54, 0.74].some((line) => Math.abs(v - line) < 0.045)) c = [120, 120, 116];
    if (v > 0.9) c = scale(c, 0.9);
    return c;
  });
}

function paintSolar(atlas) {
  const [, , w, h] = regions.solar;
  atlas.paint(regions.solar, (x, y) => {
    const u = x / w, v = y / h;
    if (u < 0.04 || u > 0.96 || v < 0.04 || v > 0.96) return [178, 182, 188];
    if (Math.abs((u * 6) % 1 - 0.5) > 0.46 || Math.abs((v * 10) % 1 - 0.5) > 0.44) return [120, 130, 150];
    return mix([26, 40, 74], [48, 66, 104], valueNoise(x, y, 30, 61));
  });
}

function paintRoof(atlas) {
  atlas.paint(regions.roof, (x, y) => {
    let c = concrete([186, 184, 176], x, y, 71, 5, 10);
    c = scale(c, 1 - 0.1 * Math.max(0, valueNoise(x, y, 36, 72) - 0.5) / 0.5);
    if (x % 48 === 0 || y % 48 === 0) c = scale(c, 0.95);
    return c;
  });
}

export async function paint(atlas, { feature }) {
  paintCell(atlas, regions.cellA, false, 11);
  paintCell(atlas, regions.cellB, true, 13);
  paintGround(atlas, regions.ground);
  paintGround(atlas, regions.door, { door: true, seed: 33 });
  paintInner(atlas);
  paintGround(atlas, regions.innerGround, { cream: true, seed: 35 });
  paintRail(atlas);
  paintSolar(atlas);
  paintRoof(atlas);
  for (const [name, color] of Object.entries(SWATCH)) atlas.paint(regions[name], (x, y) => concrete(color, x, y, 60, 2, 0));
  await paintNameSign(atlas, regions.sign, feature);
}

export function build(mesh, { H, W, D, spec, polygon, neighbours = [], entrance = null, rotation = 0 }) {
  const { fbox, rect, polygon: roofPolygon } = mesh;
  const { pts, edges } = polygonEdges(polygon, { neighbours });
  const PARAPET = 0.9, GROUND = spec.groundHeight ?? 3.8, BAY = spec.bay ?? 3.0, OUT = 0.45;
  const roofY = H - PARAPET;
  const floors = Math.max(1, Math.round((roofY - GROUND) / (spec.floorHeight ?? 3.4)));
  const f = (roofY - GROUND) / floors;
  const random = rng(17);
  // Entrance: the outer edge nearest the given point, and the position along it.
  const door = entrance ? nearestEdge(entrance, edges) : null;
  for (const edge of edges) {
    const { frame: fr, L, kind } = edge;
    if (kind === "shared" || L < 0.8) continue;
    const outer = kind === "outer";
    const ext = edge.convexEnd ? -OUT : 0; // relief continues round a convex corner
    const endFace = edge.convexEnd ? "l" : "";
    const n = Math.max(1, Math.round(L / BAY)), m = L / n;
    const doorA = door?.edge === edge ? Math.max(1.6, Math.min(L - 1.6, door.a)) : null;
    for (let k = 0; k < n; k += 1) {
      const [a0, a1] = [k * m, (k + 1) * m];
      const isDoor = doorA !== null && doorA >= a0 && doorA < a1;
      fbox(fr, [a0, a1], [0, GROUND], [0, 0.1], "o", outer ? (isDoor ? "door" : "ground") : "innerGround", 0.9);
      for (let i = 0; i < floors; i += 1) fbox(fr, [a0, a1], [GROUND + i * f, GROUND + (i + 1) * f], [0, 0.1], "o", outer ? (random() < 0.35 ? "cellB" : "cellA") : "inner", outer ? 0.85 : 0.88);
    }
    if (outer) {
      for (let k = 0; k <= n; k += 1) {
        const a = k * m;
        fbox(fr, [Math.max(0, a - 0.2), Math.min(L, a + 0.2)], [0, roofY], [-OUT, 0], "o" + (k > 0 ? "l" : "") + (k < n ? "r" : ""), "concrete");
      }
      if (edge.convexEnd) fbox(fr, [-OUT, 0], [0, roofY], [-OUT, 0], "ol", "concrete");
      fbox(fr, [ext, L], [0, 0.6], [-OUT, 0], "ot" + endFace, "concrete", 0.95);
      for (let i = 0; i < floors; i += 1) {
        const y = GROUND + i * f;
        fbox(fr, [ext, L], [y - 0.28, y], [-OUT, 0], "otb" + endFace, "concrete");
        fbox(fr, [ext, L], [y, y + 1.05], [-OUT, -0.22], "oti" + endFace, "rail", 1);
      }
    } else {
      for (let i = 0; i < floors; i += 1) fbox(fr, [ext, L], [GROUND + i * f - 0.25, GROUND + i * f], [-0.3, 0], "otb" + endFace, "concrete", 0.9);
    }
    fbox(fr, [ext, L], [roofY, H], [outer ? -OUT : -0.3, 0.25], "oti" + endFace, "concrete", 1);

    if (doorA !== null) {
      // Entrance: signboard over the door, steps, planters with red boxes.
      fbox(fr, [doorA - 2.2, doorA + 2.2], [2.75, 3.45], [-0.72, -0.55], "o", "sign", 1);
      fbox(fr, [doorA - 2.2, doorA + 2.2], [2.75, 3.45], [-0.72, -0.55], "lrtb", "metal", 0.9);
      fbox(fr, [doorA - 1.8, doorA + 1.8], [0, 0.3], [-1.3, -OUT], "otlr", "concrete", 0.95);
      for (const [p0, p1] of [[Math.max(0.5, doorA - 14), doorA - 2.6], [doorA + 2.6, Math.min(L - 0.5, doorA + 14)]]) {
        for (let a = p0; a + 2.2 <= p1; a += 3) {
          fbox(fr, [a, a + 2.2], [0, 0.7], [-2.0, -1.3], "oilr", "brick", 0.95);
          fbox(fr, [a, a + 2.2], [0, 0.7], [-2.0, -1.3], "t", "red", 0.95);
        }
      }
    }
  }

  // Roof, solar panels along the edge facing north, a stair room or an open shed.
  const uv = (x, z) => [(x + W / 2) / W, 1 - (z + D / 2) / D];
  roofPolygon(pts, roofY, "roof", 1, uv);
  const clearance = (p) => Math.min(...edges.map((edge) => segmentDistance(p, edge.A, edge.B)));
  const bearing = (n) => worldBearing(n, rotation);
  const north = edges.filter((edge) => edge.kind === "outer").map((edge) => ({ edge, off: Math.min(bearing(edge.n), 360 - bearing(edge.n)) })).sort((a, b) => a.off - b.off)[0];
  if (north && north.off < 60) {
    const { frame: fr, L, n } = north.edge;
    const tilt = 20 * Math.PI / 180;
    const normal = [-n[0] * Math.sin(tilt), Math.cos(tilt), -n[1] * Math.sin(tilt)];
    for (let a = 3; a <= L - 3; a += 2.4) {
      const p = fr.at(a, roofY + 0.8, 3.4);
      if (!inside([p[0], p[2]], pts) || clearance([p[0], p[2]]) < 1.3) continue;
      rect(p, normal, fr.right, 1.9, 1.15, "solar", 1);
      rect([p[0] - normal[0] * 0.03, p[1] - normal[1] * 0.03, p[2] - normal[2] * 0.03], mul(normal, -1), mul(fr.right, -1), 1.9, 1.15, "metal", 0.8);
    }
  }
  if (spec.roofStructure) {
    const best = interiorPoint(pts, edges);
    if (best && best.clearance > 3) {
      const { x, z } = best;
      if (spec.roofStructure === "stair") mesh.box([x - 1.8, x + 1.8], [roofY, roofY + 2.8], [z - 1.5, z + 1.5], "+z -z +x -x +y", "roofbox", 0.95);
      else {
        for (const [dx, dz] of [[-2.8, -1.8], [2.8, -1.8], [-2.8, 1.8], [2.8, 1.8]]) mesh.box([x + dx - 0.12, x + dx + 0.12], [roofY, roofY + 2.2], [z + dz - 0.12, z + dz + 0.12], "+z -z +x -x", "concrete");
        // Sloped roof of the open shed.
        const low = roofY + 2.0, high = roofY + 2.9;
        mesh.face([[x - 3.1, low, z + 2.1], [x + 3.1, low, z + 2.1], [x + 3.1, high, z - 2.1], [x - 3.1, high, z - 2.1]], [0, 0.98, 0.2], "concrete", 1);
        mesh.face([[x - 3.1, low - 0.12, z + 2.1], [x + 3.1, low - 0.12, z + 2.1], [x + 3.1, high - 0.12, z - 2.1], [x - 3.1, high - 0.12, z - 2.1]], [0, -0.98, -0.2], "dark", 0.9);
      }
    }
  }
  return { edges: edges.map((edge) => edge.kind) };
}

