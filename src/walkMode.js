import { MercatorCoordinate } from "maplibre-gl";

// First-person walk mode. The toggle first asks for a location: the next click
// on the map is where the camera goes down to eye height and walking starts.
//
// BCSIR additions (all optional; without them walking works as before):
// - resolveMove(from, to) -> { position, blocked, blocker }: collision, so walls
//   and buildings cannot be walked through (navigation/collision.js);
// - resolveStart(position) -> { position, message }: a start chosen inside a
//   building is moved outside it;
// - onPose({ position, heading }) after every camera change (minimap, guidance);
// - onStateChange(state): "idle" | "choosing" | "entering" | "active";
// - onManualInput(): the user moved or turned (keys, on-screen pad or look);
// - steer({ position, heading, forward, deltaSeconds }) -> degrees to turn this
//   frame (route assist while walking forward in a navigation session);
// - open(position, { heading }), close({ restoreCamera, message }), getPose()
//   and setPose(position, heading) for live navigation.
// The frame loop runs only while a movement key or button is held, so an idle
// first-person view does not re-render the map.
const EYE_HEIGHT_METERS = 1.65;
const LOOK_AHEAD_METERS = 16;
const WALK_SPEED_METERS_PER_SECOND = 2;
const SHIFT_SPEED_MULTIPLIER = 4;
const TURN_SPEED_DEGREES_PER_SECOND = 105;
const MOUSE_SENSITIVITY = 0.16;
const TOUCH_LOOK_SENSITIVITY = 0.28;
const DESCENT_DURATION_MS = 1800;
const BLOCKED_HINT_INTERVAL_MS = 5000;

// Label and accessible name of the toggle in each state.
const TOGGLE_TEXT = {
  idle: { label: "Walk", aria: "Walk: choose a location on the map to walk from in first-person view" },
  choosing: { label: "Click a location", aria: "Cancel choosing a first-person location" },
  active: { label: "Exit", aria: "Exit first-person walk mode" }
};

const MOVEMENT_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "ShiftLeft", "ShiftRight"
]);

function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function normalizedHeading(value) {
  return ((Number(value) || 0) % 360 + 360) % 360;
}

function toArray(position) {
  if (Array.isArray(position)) return [Number(position[0]), Number(position[1])];
  if (position && Number.isFinite(position.lng)) return [position.lng, position.lat];
  return null;
}

function offsetLngLat(origin, eastMeters, northMeters) {
  const mercator = MercatorCoordinate.fromLngLat(origin);
  const units = mercator.meterInMercatorCoordinateUnits();
  return new MercatorCoordinate(
    mercator.x + eastMeters * units,
    mercator.y - northMeters * units,
    mercator.z
  ).toLngLat();
}

function offsetFromHeading(origin, heading, rightMeters, forwardMeters) {
  const angle = heading * Math.PI / 180;
  const east = forwardMeters * Math.sin(angle) + rightMeters * Math.cos(angle);
  const north = forwardMeters * Math.cos(angle) - rightMeters * Math.sin(angle);
  return offsetLngLat(origin, east, north);
}

export function createWalkMode({
  map,
  onToast,
  beforeOpen,
  getFloorElevation = () => 0,
  getLevelLabel = () => "Floor",
  resolveMove = null,
  resolveStart = null,
  onPose = null,
  onStateChange = null,
  onManualInput = null,
  steer = null
} = {}) {
  const toggle = document.querySelector("#walk-mode");
  const toggleLabel = toggle?.querySelector(".walk-button-label");
  const panel = document.querySelector("#walk-panel");
  const closeButton = document.querySelector("#walk-close");
  const lookSurface = document.querySelector("#walk-look-surface");
  const reticle = document.querySelector("#walk-reticle");
  const lookHint = document.querySelector("#walk-look-hint");
  const heightReadout = document.querySelector("#walk-height");
  const headingReadout = document.querySelector("#walk-heading");

  if (!map || !toggle || !panel || !lookSurface) {
    return { isActive: () => false, isChoosing: () => false, cancelChoosing: () => {}, open: () => {}, close: () => {}, getPose: () => null, setPose: () => {} };
  }

  const interactionNames = ["boxZoom", "doubleClickZoom", "dragPan", "dragRotate", "keyboard", "scrollZoom", "touchZoomRotate"];
  const pressed = new Set();
  const player = { position: null, heading: 0 };
  let active = false;
  let choosing = false; // waiting for a click on the map
  let entering = false; // camera going down to the chosen location
  let descent = 0; // id of the current descent, so a cancelled one is ignored
  let animationFrame = 0;
  let previousFrameTime = 0;
  let previousCamera = null;
  let previousMaxPitch = null;
  let previousCenterClamp = null;
  let suspendedInteractions = [];
  let draggingLook = false;
  let previousPointerX = 0;
  let lastBlockedHint = { id: null, time: 0 };

  function floorElevation() {
    const value = Number(getFloorElevation?.());
    return Number.isFinite(value) ? value : 0;
  }

  function currentState() {
    if (active) return "active";
    if (entering) return "entering";
    return choosing ? "choosing" : "idle";
  }
  function emitState() { onStateChange?.(currentState()); }

  function updateReadout() {
    if (heightReadout) heightReadout.textContent = `${getLevelLabel?.() || "Floor"} · ${EYE_HEIGHT_METERS.toFixed(2)} m`;
    if (headingReadout) headingReadout.textContent = `${Math.round(normalizedHeading(player.heading))}°`;
  }

  function pose() {
    return player.position ? { position: [player.position.lng, player.position.lat], heading: normalizedHeading(player.heading) } : null;
  }

  function firstPersonCamera() {
    const eyeAltitude = floorElevation() + EYE_HEIGHT_METERS;
    const ahead = offsetFromHeading(player.position, player.heading, 0, LOOK_AHEAD_METERS);

    // Same eye-to-target calculation as MapLibre's official first-person example.
    // Both points stay at eye height above the active floor.
    return map.calculateCameraOptionsFromTo(
      player.position,
      eyeAltitude,
      ahead,
      eyeAltitude
    );
  }

  function updateCamera() {
    if (!active || !player.position) return;
    map.jumpTo(firstPersonCamera(), { walkMode: true });
    updateReadout();
    onPose?.(pose());
  }

  function notifyBlocked(blocker) {
    const now = performance.now();
    const id = blocker?.id ?? "wall";
    if (lastBlockedHint.id === id && now - lastBlockedHint.time < BLOCKED_HINT_INTERVAL_MS) return;
    lastBlockedHint = { id, time: now };
    if (blocker?.kind === "building") onToast?.(`${blocker.name || "This building"} has no indoor map, so it cannot be entered.`);
    else onToast?.(`${blocker?.name || "A wall"} blocks the way.`);
  }

  function movePlayer(rightMeters, forwardMeters) {
    if (!active || !player.position || (!rightMeters && !forwardMeters)) return;
    const target = offsetFromHeading(player.position, player.heading, rightMeters, forwardMeters);
    if (!resolveMove) { player.position = target; return; }
    const from = [player.position.lng, player.position.lat];
    const result = resolveMove(from, [target.lng, target.lat]);
    const next = toArray(result?.position ?? result) || from;
    const wanted = Math.hypot(rightMeters, forwardMeters);
    const moved = Math.hypot((next[0] - from[0]) * 111320 * Math.cos(from[1] * Math.PI / 180), (next[1] - from[1]) * 110574);
    player.position = { lng: next[0], lat: next[1] };
    if (result?.blocked && moved < wanted * 0.3) notifyBlocked(result.blocker);
  }

  function rotatePlayer(degrees) {
    if (!active || !degrees) return;
    player.heading = normalizedHeading(player.heading + degrees);
  }

  function frame(time) {
    animationFrame = 0;
    if (!active) return;
    if (!previousFrameTime) previousFrameTime = time;
    const deltaSeconds = Math.min(0.05, (time - previousFrameTime) / 1000);
    previousFrameTime = time;

    const speedBoost = pressed.has("ShiftLeft") || pressed.has("ShiftRight") ? SHIFT_SPEED_MULTIPLIER : 1;
    let forward = 0;
    let right = 0;
    let turn = 0;

    if (pressed.has("KeyW") || pressed.has("ArrowUp")) forward += 1;
    if (pressed.has("KeyS") || pressed.has("ArrowDown")) forward -= 1;
    if (pressed.has("KeyA")) right -= 1;
    if (pressed.has("KeyD")) right += 1;
    if (pressed.has("KeyQ") || pressed.has("ArrowLeft")) turn -= 1;
    if (pressed.has("KeyE") || pressed.has("ArrowRight")) turn += 1;

    const magnitude = Math.hypot(right, forward) || 1;
    const distance = WALK_SPEED_METERS_PER_SECOND * speedBoost * deltaSeconds;
    const assist = forward > 0 && !turn && !draggingLook ? Number(steer?.({ ...pose(), forward, deltaSeconds })) || 0 : 0;
    movePlayer(right / magnitude * distance, forward / magnitude * distance);
    rotatePlayer(turn * TURN_SPEED_DEGREES_PER_SECOND * deltaSeconds + assist);
    if (right || forward || turn) updateCamera();

    if (hasMovementInput()) animationFrame = requestAnimationFrame(frame);
    else previousFrameTime = 0;
  }

  function hasMovementInput() {
    for (const code of pressed) if (!code.startsWith("Shift")) return true;
    return false;
  }

  // Starts the frame loop if it is not running (keys held down keep it going).
  function wake() {
    if (active && !animationFrame && hasMovementInput()) animationFrame = requestAnimationFrame(frame);
  }

  function suspendMapInteractions() {
    suspendedInteractions = interactionNames.map((name) => {
      const handler = map[name];
      const enabled = Boolean(handler?.isEnabled?.());
      handler?.disable?.();
      return { handler, enabled };
    });
  }

  function restoreMapInteractions() {
    suspendedInteractions.forEach(({ handler, enabled }) => { if (enabled) handler?.enable?.(); });
    suspendedInteractions = [];
  }

  function rememberCamera() {
    previousCamera = {
      center: map.getCenter().toArray(),
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      padding: { ...map.getPadding() }
    };
    previousMaxPitch = map.getMaxPitch?.() ?? 85;
    previousCenterClamp = map.getCenterClampedToGround?.() ?? true;
  }

  function releasePointerLock() {
    if (document.pointerLockElement === lookSurface) document.exitPointerLock?.();
    draggingLook = false;
  }

  function setToggleState(state) {
    const text = TOGGLE_TEXT[state];
    toggle.classList.toggle("active", state === "active");
    toggle.classList.toggle("choosing", state === "choosing");
    toggle.setAttribute("aria-pressed", String(state !== "idle"));
    toggle.setAttribute("aria-label", text.aria);
    if (toggleLabel) toggleLabel.textContent = text.label;
  }

  // Step 1: wait for the user to click the location to walk from.
  function startChoosing() {
    if (choosing || active || entering) return;
    if (beforeOpen?.() === false) return;
    choosing = true;
    document.documentElement.classList.add("walk-choosing");
    setToggleState("choosing");
    onToast?.("Click a location on the map to go down into first-person view. Press Esc to cancel.");
    emitState();
  }

  function cancelChoosing() {
    if (!choosing) return;
    choosing = false;
    document.documentElement.classList.remove("walk-choosing");
    setToggleState("idle");
    emitState();
  }

  // Step 2: the camera goes down to eye height at `position`, then walking starts.
  function enterAt(position, { heading = null } = {}) {
    if (active || entering) return;
    if (choosing) cancelChoosing();
    else if (beforeOpen?.() === false) return;
    const start = resolveStart?.(toArray(position)) || null;
    const startPosition = toArray(start?.position) || toArray(position);
    if (start?.message) onToast?.(start.message);
    rememberCamera();
    map.stop();
    suspendMapInteractions();
    map.setMaxPitch?.(95);
    map.setCenterClampedToGround?.(false);

    player.position = { lng: startPosition[0], lat: startPosition[1] };
    player.heading = normalizedHeading(Number.isFinite(heading) ? heading : map.getBearing());
    entering = true;
    const id = ++descent;
    document.documentElement.classList.add("walk-mode-active");
    setToggleState("active");
    emitState();
    map.once("moveend", () => { if (id === descent && entering) activate(); });
    map.easeTo({ ...firstPersonCamera(), duration: DESCENT_DURATION_MS, essential: true }, { walkMode: true });
  }

  function activate() {
    entering = false;
    active = true;
    pressed.clear();
    previousFrameTime = 0;
    panel.hidden = false;
    lookSurface.hidden = false;
    if (reticle) reticle.hidden = false;
    updateCamera();
    onToast?.(window.matchMedia?.("(pointer: coarse)").matches
      ? "Walk mode on — hold the arrow buttons to walk, drag the view to look around."
      : "Walk mode on — use W/A/S/D, arrows, or the on-screen controls.");
    emitState();
  }

  function exit({ restoreCamera = true, message = "Walk mode off — previous view restored." } = {}) {
    if (!active && !entering) return;
    active = false;
    entering = false;
    descent += 1;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    previousFrameTime = 0;
    pressed.clear();
    panel.querySelectorAll(".pressed").forEach((button) => button.classList.remove("pressed"));
    releasePointerLock();
    panel.hidden = true;
    lookSurface.hidden = true;
    if (reticle) reticle.hidden = true;
    document.documentElement.classList.remove("walk-mode-active");
    setToggleState("idle");

    map.stop();
    map.setMaxPitch?.(previousMaxPitch ?? 85);
    map.setCenterClampedToGround?.(previousCenterClamp ?? true);
    restoreMapInteractions();
    if (restoreCamera && previousCamera) map.easeTo({ ...previousCamera, duration: 520, essential: true });
    if (message) onToast?.(message);
    emitState(); // after the message, so a listener's own message replaces it
  }

  function setControlPressed(button, isPressed) {
    const code = button?.dataset.walkKey;
    if (!code) return;
    if (isPressed) pressed.add(code); else pressed.delete(code);
    button.classList.toggle("pressed", isPressed);
    if (isPressed) { onManualInput?.(); wake(); }
  }

  toggle.addEventListener("click", () => {
    if (active || entering) exit();
    else if (choosing) cancelChoosing();
    else startChoosing();
  });
  closeButton?.addEventListener("click", () => exit());

  // A click (not a drag) on the map while choosing picks the location.
  map.on("click", (event) => { if (choosing) enterAt(event.lngLat); });

  panel.querySelectorAll("[data-walk-key]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      if (!active) return;
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      setControlPressed(button, true);
    });
    button.addEventListener("pointerup", () => setControlPressed(button, false));
    button.addEventListener("lostpointercapture", () => setControlPressed(button, false));
    button.addEventListener("pointercancel", () => setControlPressed(button, false));
    // A long press on a phone must not open the context menu.
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  });

  window.addEventListener("keydown", (event) => {
    if (isTypingTarget(event.target)) return;
    if (choosing && event.code === "Escape") { event.preventDefault(); cancelChoosing(); return; }
    if (!active && !entering) return;
    if (event.code === "Escape") { event.preventDefault(); exit(); return; }
    if (!active || !MOVEMENT_KEYS.has(event.code)) return;
    event.preventDefault();
    if (!pressed.has(event.code) && !event.code.startsWith("Shift")) onManualInput?.();
    pressed.add(event.code);
    wake();
  });

  window.addEventListener("keyup", (event) => {
    if (!active || !MOVEMENT_KEYS.has(event.code)) return;
    event.preventDefault();
    pressed.delete(event.code);
  });

  window.addEventListener("blur", () => pressed.clear());

  lookSurface.addEventListener("pointerdown", (event) => {
    if (!active) return;
    event.preventDefault();
    draggingLook = true;
    previousPointerX = event.clientX;
    lookSurface.setPointerCapture?.(event.pointerId);
    if (event.pointerType === "mouse") {
      try {
        const pointerLockRequest = lookSurface.requestPointerLock?.();
        pointerLockRequest?.catch?.(() => { /* drag-to-look remains available */ });
      } catch (_) { /* drag-to-look remains available */ }
    }
  });

  lookSurface.addEventListener("pointermove", (event) => {
    if (!active || !draggingLook || document.pointerLockElement === lookSurface) return;
    const movement = event.clientX - previousPointerX;
    previousPointerX = event.clientX;
    if (!movement) return;
    onManualInput?.();
    rotatePlayer(movement * (event.pointerType === "mouse" ? MOUSE_SENSITIVITY : TOUCH_LOOK_SENSITIVITY));
    updateCamera();
  });

  lookSurface.addEventListener("lostpointercapture", () => { draggingLook = false; });
  lookSurface.addEventListener("pointercancel", () => { draggingLook = false; });

  document.addEventListener("mousemove", (event) => {
    if (!active || document.pointerLockElement !== lookSurface || !event.movementX) return;
    onManualInput?.();
    rotatePlayer(event.movementX * MOUSE_SENSITIVITY);
    updateCamera();
  });

  document.addEventListener("pointerlockchange", () => {
    if (lookHint) lookHint.textContent = document.pointerLockElement === lookSurface
      ? "Move mouse to look · Esc exits"
      : "Click or drag to look";
  });

  return {
    isActive: () => active || entering,
    isChoosing: () => choosing,
    cancelChoosing,
    open: (position, options) => enterAt(position || map.getCenter(), options),
    close: exit,
    getPose: pose,
    // Live navigation drives the walker from GPS and the compass.
    setPose(position, heading) {
      const next = toArray(position);
      if (!active || !next) return;
      player.position = { lng: next[0], lat: next[1] };
      if (Number.isFinite(heading)) player.heading = normalizedHeading(heading);
      updateCamera();
    }
  };
}
