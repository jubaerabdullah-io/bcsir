// Development only (loaded by app.js under import.meta.env.DEV): a "Simulate"
// button under the route summary when a mock GPS track exists for the chosen
// pair of buildings, in either direction (npm run mock:tracks). It starts live
// navigation with GPS replaced by the track (see createLiveNavigation's
// getGeolocation); a small floating control sets the playback speed (4x by
// default) and pauses and resumes the replay.
// Ending navigation stops it. Neither this module nor the tracks are in a build.
import { fetchPublicJSON } from "../core/paths.js";
import { createFakeGeolocation, DEFAULT_RATE, findTrack, NOISY, PLAYBACK_RATES, trackFixes } from "./gps-simulator.js";

const TRACKS_DIR = "data/bcsir/mock-tracks";

const STYLE = `
.route-sim svg { fill: #c2410c; }
.dev-sim {
  position: fixed; z-index: var(--z-nav-alert); left: 12px;
  bottom: calc(max(12px, env(safe-area-inset-bottom)) + 150px);
  display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px;
  border: 1px solid #c2410c; border-radius: 999px; background: var(--surface); color: var(--text);
  box-shadow: var(--shadow); font: 600 12.5px/1 system-ui, sans-serif; font-variant-numeric: tabular-nums;
}
.dev-sim b { color: #c2410c; letter-spacing: 0.04em; }
.dev-sim button {
  min-width: 30px; padding: 0 6px; height: 30px; border: 1px solid var(--border-strong); border-radius: 50%;
  background: var(--surface); color: var(--text); font-size: 13px; cursor: pointer;
}
`;

export function createSimulatorUI({ getNavigation, onToast } = {}) {
  const actions = document.querySelector("#route-actions");
  if (!actions) return null;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);

  const button = document.createElement("button");
  button.id = "route-simulate";
  button.className = "route-3d route-sim";
  button.type = "button";
  button.hidden = true;
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z"/></svg><span>Simulate</span>';
  actions.append(button);

  const control = document.createElement("div");
  control.className = "dev-sim";
  control.hidden = true;
  control.innerHTML = '<b>SIM</b><span></span><button type="button" class="dev-sim-rate"></button><button type="button" class="dev-sim-pause" aria-label="Pause the simulated GPS">⏸</button>';
  const label = control.querySelector("span");
  const rateButton = control.querySelector(".dev-sim-rate");
  const toggle = control.querySelector(".dev-sim-pause");
  let rate = DEFAULT_RATE; // kept for the next simulation
  const showRate = () => {
    rateButton.textContent = `${rate}×`;
    rateButton.setAttribute("aria-label", `Playback speed ${rate} times; change`);
  };
  showRate();
  document.body.append(control);

  let index = null;
  const indexLoad = fetchPublicJSON(`${TRACKS_DIR}/index.json`)
    .then((value) => { index = value; })
    .catch(() => console.info("[simulator] No mock GPS tracks; run `npm run mock:tracks` to create them."));
  const tracks = new Map(); // track id -> Promise<track JSON>
  let match = null; // { entry, reversed } for the chosen pair
  let active = null; // fake geolocation while a simulation runs
  let lastSelection = null;

  function update(selection, position) {
    lastSelection = { selection, position };
    const from = selection?.source?.properties?.id, to = selection?.destination?.properties?.id;
    match = !position && from != null && to != null && index ? findTrack(index, from, to) : null;
    button.hidden = !match;
    if (match) {
      const { entry, reversed } = match;
      button.title = `Replay mock GPS: ${reversed ? `${entry.to.name} → ${entry.from.name} (reversed)` : entry.name}${NOISY ? ", with GPS noise" : ""}, ${rate}× speed`;
    }
  }
  // The selection may come before the index has loaded.
  indexLoad.then(() => { if (lastSelection) update(lastSelection.selection, lastSelection.position); });

  function showProgress(delivered, total) {
    label.textContent = delivered >= total ? `done ${total}/${total}` : `${delivered}/${total}`;
  }

  button.addEventListener("click", async () => {
    const chosen = match;
    if (!chosen) return;
    const { entry, reversed } = chosen;
    if (!tracks.has(entry.id)) tracks.set(entry.id, fetchPublicJSON(`${TRACKS_DIR}/${entry.files.json}`));
    let track;
    try {
      track = await tracks.get(entry.id);
    } catch (error) {
      tracks.delete(entry.id);
      onToast?.(`Mock track ${entry.id} could not be loaded`);
      console.error(error);
      return;
    }
    if (match !== chosen) return; // the route changed while loading
    const fixes = trackFixes(track, { reversed });
    getNavigation?.()?.end?.({ restoreCamera: false });
    active = createFakeGeolocation(fixes, globalThis, { rate, onProgress: showProgress });
    showProgress(0, fixes.length);
    toggle.textContent = "⏸";
    toggle.setAttribute("aria-label", "Pause the simulated GPS");
    if (getNavigation?.()?.start({ view: "map" })) {
      control.hidden = false;
      onToast?.(`Simulating GPS: ${reversed ? `${entry.to.name} → ${entry.from.name}` : entry.name}`);
    } else {
      active = null;
    }
  });

  rateButton.addEventListener("click", () => {
    rate = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate) + 1) % PLAYBACK_RATES.length];
    active?.setRate(rate);
    showRate();
    if (lastSelection) update(lastSelection.selection, lastSelection.position);
  });

  toggle.addEventListener("click", () => {
    if (!active) return;
    if (active.isPaused()) active.resume(); else active.pause();
    const paused = active.isPaused();
    toggle.textContent = paused ? "▶" : "⏸";
    toggle.setAttribute("aria-label", paused ? "Resume the simulated GPS" : "Pause the simulated GPS");
  });

  return {
    update,
    // The GPS source for live navigation: the replayed track while simulating.
    geolocation: () => active || navigator.geolocation,
    sessionChanged(on) {
      if (on) return;
      active = null;
      control.hidden = true;
    }
  };
}
