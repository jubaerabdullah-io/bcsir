// Camera framing (map/camera-fit.js) and guidance inside the destination building
// (navigation/indoor-guidance.js).
import assert from "node:assert/strict";
import test from "node:test";
import { axisBearings, chooseBearing, circlePoints, fitView, pixelsPerMetre, principalBearing } from "../src/map/camera-fit.js";
import { indoorStages, nextIndoorStage, remainingAfter } from "../src/navigation/indoor-guidance.js";
import { createLocalFrame, DEG } from "../src/utils/local-frame.js";

const frame = createLocalFrame([90.385, 23.74]);
// Corners of a w x h metre rectangle around the origin, long side `w` along `bearing`.
function rectangle(w, h, bearing = 90, height = 0) {
  const b = bearing * DEG, along = [Math.sin(b), Math.cos(b)], across = [Math.cos(b), -Math.sin(b)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [...frame.toLngLat([along[0] * i * w / 2 + across[0] * j * h / 2, along[1] * i * w / 2 + across[1] * j * h / 2]), height]);
}

// An independent perspective camera (a look-at camera in metres), as MapLibre's:
// screen position of a point for the camera of a fitView() result.
function screenOf(point, { center, zoom, pitch, bearing, width, height, fov = 36.87 }) {
  const k = pixelsPerMetre(zoom, center[1]);
  const local = createLocalFrame(center);
  const [x, y] = local.toLocal(point);
  const p = [x * k, y * k, (point[2] || 0) * k]; // pixels, east / north / up
  const d = (0.5 * height) / Math.tan((fov * DEG) / 2);
  const b = bearing * DEG, t = pitch * DEG;
  const forwardGround = [Math.sin(b), Math.cos(b)];
  const eye = [-forwardGround[0] * d * Math.sin(t), -forwardGround[1] * d * Math.sin(t), d * Math.cos(t)];
  const forward = [forwardGround[0] * Math.sin(t), forwardGround[1] * Math.sin(t), -Math.cos(t)];
  const right = [Math.cos(b), -Math.sin(b), 0];
  const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const v = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  const depth = dot(v, forward);
  return [width / 2 + (d * dot(v, right)) / depth, height / 2 - (d * dot(v, up)) / depth];
}

test("fitView: from straight above, a box fills the screen exactly", () => {
  const points = rectangle(100, 50, 90);
  const fit = fitView(points, { width: 1000, height: 500, pitch: 0, bearing: 0 });
  assert.ok(fit.fits);
  assert.ok(Math.abs(pixelsPerMetre(fit.zoom, fit.center[1]) - 10) < 0.01, "100 m across 1000 px");
  const [x, y] = frame.toLocal(fit.center);
  assert.ok(Math.hypot(x, y) < 0.05, "centred on the box");
});

test("fitView: tilted and turned, every point is on screen and the framing is tight", () => {
  const view = { width: 390, height: 844, padding: { top: 70, bottom: 260, left: 14, right: 60 } };
  for (const [pitch, bearing, height] of [[0, 30, 0], [52, 78, 2.2], [72, 168, 2.2], [58, 116, 20]]) {
    const points = [...rectangle(32, 21, 78), ...rectangle(32, 21, 78, height)];
    const fit = fitView(points, { ...view, pitch, bearing, maxZoom: 24 });
    const screen = points.map((point) => screenOf(point, { ...view, ...fit, pitch, bearing }));
    const xs = screen.map((s) => s[0]), ys = screen.map((s) => s[1]);
    const { top, bottom, left, right } = view.padding;
    assert.ok(Math.min(...xs) >= left - 0.6 && Math.max(...xs) <= view.width - right + 0.6, `pitch ${pitch}: inside left and right`);
    assert.ok(Math.min(...ys) >= top - 0.6 && Math.max(...ys) <= view.height - bottom + 0.6, `pitch ${pitch}: inside top and bottom`);
    const fill = Math.max((Math.max(...xs) - Math.min(...xs)) / (view.width - left - right), (Math.max(...ys) - Math.min(...ys)) / (view.height - top - bottom));
    assert.ok(fill > 0.99, `pitch ${pitch}: fills the free part (${fill.toFixed(3)})`);
    // In the middle of the free part.
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - (left + (view.width - left - right) / 2)) < 1);
  }
});

test("fitView: never closer than maxZoom, and reports a box too large for minZoom", () => {
  const fit = fitView(rectangle(4, 4), { width: 800, height: 600, maxZoom: 20 });
  assert.equal(fit.zoom, 20);
  assert.equal(fitView(rectangle(5000, 5000), { width: 800, height: 600, minZoom: 18 }).fits, false);
  assert.equal(fitView([], { width: 800, height: 600 }), null);
});

test("chooseBearing: a long building runs along the long side of the screen", () => {
  const building = rectangle(40, 12, 80); // long axis towards the east
  const candidates = axisBearings(80);
  const portrait = { width: 390, height: 844 }, landscape = { width: 1280, height: 800 };
  const upright = chooseBearing(building, portrait, { candidates, current: 10 });
  assert.equal(upright, 80, "on a phone: turned to run up the screen, the turn nearest the present bearing");
  assert.equal(chooseBearing(building, portrait, { candidates, current: 250 }), 260);
  assert.ok([170, 350].includes(chooseBearing(building, landscape, { candidates, current: 0 })), "on a wide screen: across it");
  // The present bearing stays unless another is clearly better.
  assert.equal(chooseBearing(rectangle(40, 38, 80), landscape, { candidates, current: 167, keep: 167 }), 167);
  assert.equal(chooseBearing(building, portrait, { candidates, current: 167, keep: 167 }), 80, "... unless another is clearly better");
});

test("principalBearing and axisBearings", () => {
  const line = [0, 10, 20, 30].map((m) => frame.toLngLat([m * Math.sin(30 * DEG), m * Math.cos(30 * DEG)]));
  assert.ok(Math.abs(principalBearing(line) - 30) < 0.01);
  assert.ok(Math.abs(principalBearing(rectangle(50, 10, 120)) - 120) < 0.01);
  assert.deepEqual(axisBearings(30, 45), [75, 165, 255, 345]);
  assert.deepEqual(axisBearings(30, 90, 180), [120, 300]);
  assert.equal(circlePoints([90.385, 23.74], 8).length, 16);
});

test("indoor guidance: in through the entrance, to the lift, up, and on to the room", () => {
  const at = (x, y) => frame.toLngLat([x, y]);
  const legs = [
    { type: "walk", building: "b", level: "L01", coordinates: [at(0, 0), at(0, 5), at(10, 5)], to: "Lift A" },
    { type: "connector", building: "b", class: "lift", name: "Lift A", fromLevel: "L01", toLevel: "L06", direction: "up" },
    { type: "walk", building: "b", level: "L06", coordinates: [at(10, 5), at(4, 5), at(4, 9)], to: "Board Room" }
  ];
  const stages = indoorStages(legs);
  assert.equal(stages.length, 3);
  assert.equal(Math.round(remainingAfter(stages, 0)), 10);
  // Outside, at the entrance: the first leg.
  assert.equal(nextIndoorStage(stages, 0, null, at(0, -1)), 0);
  // Inside on the first floor, half way: still the first leg; at the lift: the lift.
  assert.equal(nextIndoorStage(stages, 0, { building: "b", level: "L01" }, at(5, 5)), 0);
  assert.equal(nextIndoorStage(stages, 0, { building: "b", level: "L01" }, at(9.5, 5)), 1);
  // The lift waits for the floor; on L06 the last leg.
  assert.equal(nextIndoorStage(stages, 1, { building: "b", level: "L01" }, at(10, 5)), 1);
  assert.equal(nextIndoorStage(stages, 1, { building: "b", level: "L06" }, at(10, 5)), 2);
  // At the room: arrived (past the last stage).
  assert.equal(nextIndoorStage(stages, 2, { building: "b", level: "L06" }, at(4, 8.5)), 3);
  // A floor reached another way skips to the walk on it.
  assert.equal(nextIndoorStage(stages, 0, { building: "b", level: "L06" }, at(10, 5)), 2);
  // At the end of a leg but on another floor (walking under it): not done.
  assert.equal(nextIndoorStage(stages, 2, { building: "b", level: "L03" }, at(4, 9)), 2);
});
