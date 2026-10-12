// Mock GPS tracks along a walked route (pure, tested with node --test).
//
// buildTrack(coordinates) walks the route at a constant speed and returns a fix
// every `stepM` metres and at every turn, shaped like a GeolocationPosition
// ({ timestamp, coords }), so a simulator can hand each fix to live navigation
// unchanged. The fixes lie exactly on the route; their times follow the walking
// pace. With noiseSigmaM > 0 there are also noisy fixes: a seeded,
// time-correlated error (first-order Gauss-Markov per axis, clamped), which is
// how a phone's GPS error drifts rather than jumping independently.
import { createRouteModel, bearingAt, pointAt } from "../../src/navigation/route-progress.js";
import { normalizeDegrees } from "../../src/utils/local-frame.js";

export const TRACK_DEFAULTS = {
  speedMps: 1.3, // walking pace
  stepM: 5, // distance between fixes along the route (turns get a fix of their own)
  dwellStartS: 2, // standing still at the start before walking off
  dwellEndS: 2, // standing still after arriving
  noiseSigmaM: 0, // 0: no noisy fixes
  noiseClampM: 5,
  noiseTauS: 10, // correlation time of the GPS error
  seed: 42
};

const MIN_GAP_M = 1; // turns closer than this to the previous one (or the end) get no fix of their own

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

// Small seeded PRNG (mulberry32): the same seed gives the same track.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function fix(frame, t, point, { accuracy, heading, speed }) {
  const [longitude, latitude] = frame.toLngLat(point);
  return {
    t: round(t, 3),
    timestamp: Math.round(t * 1000),
    coords: {
      latitude: round(latitude, 7),
      longitude: round(longitude, 7),
      accuracy: round(accuracy, 1),
      heading: heading === null ? null : round(heading, 1),
      speed: round(speed, 2)
    }
  };
}

// Along-distances of the fixes: the start, every turn and the destination, with
// evenly spaced fixes at most stepM metres apart between them.
export function sampleDistances(model, stepM) {
  const anchors = [0];
  model.maneuvers.map((m) => m.along).filter((d) => d > 0 && d < model.total).sort((a, b) => a - b)
    .forEach((d) => { if (d - anchors[anchors.length - 1] >= MIN_GAP_M && model.total - d >= MIN_GAP_M) anchors.push(d); });
  anchors.push(model.total);
  const output = [0];
  for (let i = 1; i < anchors.length; i += 1) {
    const from = anchors[i - 1], length = anchors[i] - from;
    const parts = Math.max(1, Math.ceil(length / stepM - 1e-9));
    for (let k = 1; k <= parts; k += 1) output.push(from + (length * k) / parts);
  }
  return output;
}

// coordinates: [[lon, lat], ...] from the start to the destination.
// Returns { model, distanceM, durationS, fixes, noisyFixes|null } or null for a degenerate route.
export function buildTrack(coordinates, options = {}) {
  const o = { ...TRACK_DEFAULTS, ...options };
  const model = createRouteModel(coordinates);
  if (!model) return null;
  const walkS = model.total / o.speedMps;
  const durationS = o.dwellStartS + walkS + o.dwellEndS;

  // { t, along, moving }: standing at the start, walking, standing at the destination.
  const samples = [];
  if (o.dwellStartS > 0) samples.push({ t: 0, along: 0, moving: false });
  sampleDistances(model, o.stepM).forEach((along) => samples.push({ t: o.dwellStartS + along / o.speedMps, along, moving: true }));
  if (o.dwellEndS > 0) samples.push({ t: durationS, along: model.total, moving: false });

  const fixes = samples.map(({ t, along, moving }) => fix(model.frame, t, pointAt(model, along), {
    accuracy: 3,
    heading: moving ? bearingAt(model, along, 1) : null,
    speed: moving ? o.speedMps : 0
  }));

  // Speed and heading come from Doppler on a phone, so they stay close to the
  // true values (and about 0 when standing) even while the position drifts.
  let noisyFixes = null;
  if (o.noiseSigmaM > 0) {
    const random = mulberry32(o.seed);
    const error = [0, 0];
    noisyFixes = samples.map(({ t, along, moving }, i) => {
      const dt = i ? t - samples[i - 1].t : 0;
      const a = Math.exp(-dt / o.noiseTauS);
      const kick = i ? Math.sqrt(1 - a * a) : 1; // first error drawn from the stationary distribution
      for (let k = 0; k < 2; k += 1) error[k] = a * error[k] + kick * o.noiseSigmaM * gaussian(random);
      const size = Math.hypot(error[0], error[1]);
      if (size > o.noiseClampM) { error[0] *= o.noiseClampM / size; error[1] *= o.noiseClampM / size; }
      const truth = pointAt(model, along);
      const speedNoise = gaussian(random) * 0.15, headingNoise = gaussian(random) * 8, accuracyNoise = random() * 2;
      return fix(model.frame, t, [truth[0] + error[0], truth[1] + error[1]], {
        accuracy: Math.min(8, Math.max(4, size + 2 + accuracyNoise)),
        heading: moving ? normalizeDegrees(bearingAt(model, along, 1) + headingNoise) : null,
        speed: moving ? Math.max(0, o.speedMps + speedNoise) : 0
      });
    });
  }

  return { model, distanceM: model.total, durationS, fixes, noisyFixes };
}

const escapeXml = (text) => String(text).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[c]);

// GPX 1.1 track; times start at `startTime` (a fixed epoch keeps output stable).
export function toGpx(name, fixes, { startTime = Date.UTC(2026, 0, 1) } = {}) {
  const points = fixes.map(({ timestamp, coords }) =>
    `      <trkpt lat="${coords.latitude}" lon="${coords.longitude}"><ele>0</ele><time>${new Date(startTime + timestamp).toISOString()}</time></trkpt>`);
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<gpx version=\"1.1\" creator=\"bcsir-3d-map mock:tracks\" xmlns=\"http://www.topografix.com/GPX/1/1\">",
    `  <trk>`,
    `    <name>${escapeXml(name)}</name>`,
    "    <trkseg>",
    ...points,
    "    </trkseg>",
    "  </trk>",
    "</gpx>",
    ""
  ].join("\n");
}
