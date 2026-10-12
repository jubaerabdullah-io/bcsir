// Development only: replays a mock GPS track (npm run mock:tracks) as if it came
// from navigator.geolocation (pure, tested with node --test).
//
// findTrack() finds the track for a pair of buildings, in either direction;
// reverseFixes() turns a track round; createFakeGeolocation() is an object with
// watchPosition / clearWatch / getCurrentPosition that delivers the fixes at
// their own times, faster by `rate`, and can be paused.

// false replays the fixes exactly on the route; true the noisy fixes, when a
// track has them (npm run mock:tracks -- --noise 3).
export const NOISY = false;
export const PLAYBACK_RATES = [1, 2, 4, 8];
export const DEFAULT_RATE = 4;

export function findTrack(index, fromId, toId) {
  const from = String(fromId), to = String(toId);
  for (const entry of index?.tracks || []) {
    if (String(entry.from?.id) === from && String(entry.to?.id) === to) return { entry, reversed: false };
  }
  for (const entry of index?.tracks || []) {
    if (String(entry.from?.id) === to && String(entry.to?.id) === from) return { entry, reversed: true };
  }
  return null;
}

// The same walk backwards: times count from the new start, headings point the other way.
export function reverseFixes(fixes) {
  if (!fixes?.length) return [];
  const last = fixes[fixes.length - 1];
  return [...fixes].reverse().map((fix) => ({
    ...fix,
    t: Math.round((last.t - fix.t) * 1000) / 1000,
    timestamp: last.timestamp - fix.timestamp,
    coords: { ...fix.coords, heading: fix.coords.heading === null ? null : (fix.coords.heading + 180) % 360 }
  }));
}

// The fixes of a track JSON in the direction walked.
export function trackFixes(track, { reversed = false, noisy = NOISY } = {}) {
  const fixes = (noisy && track.noisyFixes?.length ? track.noisyFixes : track.fixes) || [];
  return reversed ? reverseFixes(fixes) : fixes;
}

// fixes: [{ timestamp (ms from the start), coords }]; rate 4 plays them four times
// faster. The clock is injectable for tests.
export function createFakeGeolocation(fixes, clock = globalThis, { rate = 1, onProgress, onDone } = {}) {
  const now = clock.now || (() => Date.now());
  let next = 0; // index of the next fix to deliver
  let elapsed = 0; // track time (ms) reached when the timer was last (re)started
  let startedAt = 0; // clock time of that (re)start
  let timer = null;
  let watch = null; // { id, success }
  let paused = false;
  let lastId = 0;
  const position = (fix) => ({ coords: { ...fix.coords }, timestamp: now() });

  function schedule() {
    clock.clearTimeout(timer);
    timer = null;
    if (!watch || paused || next >= fixes.length) return;
    startedAt = now();
    timer = clock.setTimeout(deliver, Math.max(0, (fixes[next].timestamp - elapsed) / rate));
  }

  // Track time reached so far, kept when the timer stops (pause, a new rate).
  function holdElapsed() {
    if (timer !== null) elapsed = Math.min(fixes[next]?.timestamp ?? elapsed, elapsed + (now() - startedAt) * rate);
  }

  function deliver() {
    timer = null;
    if (!watch || paused || next >= fixes.length) return;
    elapsed = fixes[next].timestamp;
    const fix = fixes[next];
    next += 1;
    watch.success(position(fix));
    onProgress?.(next, fixes.length);
    if (next >= fixes.length) onDone?.();
    else schedule();
  }

  return {
    watchPosition(success) {
      clock.clearTimeout(timer);
      watch = { id: ++lastId, success };
      schedule();
      return watch.id;
    },
    clearWatch(id) {
      if (!watch || watch.id !== id) return;
      clock.clearTimeout(timer);
      timer = null;
      watch = null;
    },
    getCurrentPosition(success, error) {
      const fix = fixes[Math.max(0, next - 1)];
      if (fix) success(position(fix));
      else error?.({ code: 2, message: "No mock fix" });
    },
    pause() {
      if (paused) return;
      holdElapsed();
      paused = true;
      clock.clearTimeout(timer);
      timer = null;
    },
    resume() {
      if (!paused) return;
      paused = false;
      schedule();
    },
    isPaused: () => paused,
    setRate(value) {
      if (!(value > 0) || value === rate) return;
      holdElapsed();
      rate = value;
      if (timer !== null) schedule();
    },
    rate: () => rate,
    progress: () => ({ delivered: next, total: fixes.length })
  };
}
