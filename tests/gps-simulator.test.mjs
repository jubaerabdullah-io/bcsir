// Development GPS simulator: finding a track for a pair, reversing it, replaying it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFakeGeolocation, findTrack, reverseFixes, trackFixes } from "../src/dev/gps-simulator.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const readJSON = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const index = readJSON("public/data/bcsir/mock-tracks/index.json");
const track = readJSON("public/data/bcsir/mock-tracks/301-to-127.json");

// A manual clock: advance(ms) runs the timers that fall due, in order.
function fakeClock() {
  let time = 0, lastId = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout: (fn, ms) => { timers.set(++lastId, { fn, at: time + ms }); return lastId; },
    clearTimeout: (id) => { timers.delete(id); },
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].fn();
      }
      time = end;
    }
  };
}

test("findTrack finds a pair in either direction", () => {
  assert.deepEqual(findTrack(index, 301, 127), { entry: index.tracks.find((t) => t.id === "301-to-127"), reversed: false });
  assert.equal(findTrack(index, "127", "301").reversed, true);
  assert.equal(findTrack(index, "127", "301").entry.id, "301-to-127");
  assert.equal(findTrack(index, 301, 999), null);
  assert.equal(findTrack(null, 301, 127), null);
});

test("reverseFixes walks the track backwards from time 0", () => {
  const fixes = trackFixes(track, { noisy: false });
  const reversed = reverseFixes(fixes);
  assert.equal(reversed.length, fixes.length);
  assert.equal(reversed[0].timestamp, 0);
  assert.deepEqual([reversed[0].coords.latitude, reversed[0].coords.longitude], [fixes.at(-1).coords.latitude, fixes.at(-1).coords.longitude]);
  for (let i = 1; i < reversed.length; i += 1) assert.ok(reversed[i].timestamp > reversed[i - 1].timestamp);
  reversed.forEach((fix, i) => {
    const original = fixes[fixes.length - 1 - i].coords.heading;
    if (original === null) assert.equal(fix.coords.heading, null);
    else assert.ok(Math.abs(fix.coords.heading - (original + 180) % 360) < 1e-9);
  });
  assert.deepEqual(reverseFixes([]), []);
});

// Clock time (ms) at which fix i is due when played at `rate`.
const at = (fixes, i, rate = 1) => fixes[i].timestamp / rate;

test("the fake geolocation delivers every fix at its time, and pauses", () => {
  const clock = fakeClock();
  const fixes = trackFixes(track);
  let done = 0;
  const geo = createFakeGeolocation(fixes, clock, { onDone: () => { done += 1; } });
  const received = [];
  const id = geo.watchPosition((position) => received.push(position));
  clock.advance(0);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].coords, fixes[0].coords);
  clock.advance(at(fixes, 4) - 1);
  assert.equal(received.length, 4);
  clock.advance(1);
  assert.equal(received.length, 5);

  // Pause half-way to fix 5: after resuming, only the other half is waited.
  const gap = fixes[5].timestamp - fixes[4].timestamp;
  clock.advance(gap / 2);
  geo.pause();
  clock.advance(60000);
  assert.equal(received.length, 5, "nothing is delivered while paused");
  geo.resume();
  clock.advance(gap / 2 - 1);
  assert.equal(received.length, 5, "the time already waited before the pause counts");
  clock.advance(1);
  assert.equal(received.length, 6);
  assert.deepEqual(received[5].coords, fixes[5].coords);

  clock.advance(fixes.at(-1).timestamp);
  assert.equal(received.length, fixes.length);
  assert.deepEqual(received.map((p) => p.coords), fixes.map((f) => f.coords));
  assert.equal(done, 1);
  clock.advance(10000);
  assert.equal(done, 1);
  geo.clearWatch(id);
});

test("the playback rate speeds the replay up, also when changed half-way", () => {
  const clock = fakeClock();
  const fixes = trackFixes(track);
  const geo = createFakeGeolocation(fixes, clock, { rate: 4 });
  const received = [];
  geo.watchPosition((position) => received.push(position));
  clock.advance(at(fixes, 6, 4) - 1);
  assert.equal(received.length, 6);
  clock.advance(1);
  assert.equal(received.length, 7);
  assert.equal(geo.rate(), 4);

  // Half of the track time to fix 7 at 4x, then the rest at 8x.
  const gap = fixes[7].timestamp - fixes[6].timestamp;
  clock.advance(gap / 2 / 4);
  geo.setRate(8);
  clock.advance(gap / 2 / 8 - 1);
  assert.equal(received.length, 7);
  clock.advance(1);
  assert.equal(received.length, 8, "no fix skipped or repeated");
  assert.deepEqual(received[7].coords, fixes[7].coords);

  // Paused at 8x, resumed at 2x.
  geo.pause();
  geo.setRate(2);
  clock.advance(60000);
  assert.equal(received.length, 8);
  geo.resume();
  clock.advance((fixes[8].timestamp - fixes[7].timestamp) / 2);
  assert.equal(received.length, 9);

  clock.advance(fixes.at(-1).timestamp / 2);
  assert.deepEqual(received.map((p) => p.coords), fixes.map((f) => f.coords));
});

test("clearWatch stops the replay", () => {
  const clock = fakeClock();
  const fixes = trackFixes(track);
  const geo = createFakeGeolocation(fixes, clock);
  const received = [];
  const id = geo.watchPosition((position) => received.push(position));
  clock.advance(at(fixes, 2));
  geo.clearWatch(id);
  clock.advance(600000);
  assert.equal(received.length, 3);
  let current = null;
  geo.getCurrentPosition((position) => { current = position; });
  assert.deepEqual(current.coords, received.at(-1).coords);
});
