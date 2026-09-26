import { MercatorCoordinate } from "maplibre-gl";
import { WALK_CHARACTERS } from "./config.js";
import { createWalkCharacter } from "./walk-character.js";
import { createWalkSky } from "./walk-sky.js";

// Walk mode. The toggle first shows the character picker (only when there is more
// than one character), then asks for a location: the next click on the map is where
// the camera goes down and walking starts.
//
// Views (every walk starts in third person; V or the panel's view button switches):
// - third person: the chosen character (walk-character.js) stands at the player's
//   position; a follow camera stays behind and above him. W/A/S/D move relative to
//   the camera and the character turns smoothly to face the way he walks (backwards
//   too); Q/E and the arrows turn the camera, as does the mouse (left/right and
//   up/down). The camera is pulled in when a building or wall is between it and
//   the character (cameraClearance), so it never looks through them;
// - first person: the camera at eye height, as before; the mouse also looks up and
//   down. Looking level gives exactly the previous camera.
// Switching views blends the camera from one to the other at the same position.
// The character plays Idle when stopped, Walk when moving and Run with Shift.
// Game feel: a fast pace (a run with the Run clip), Space (or the pad's Jump
// button) jumps, and looking up shows the sky (walk-sky.js).
//
// BCSIR additions (all optional; without them walking works as before):
// - resolveMove(from, to) -> { position, blocked, blocker }: collision, so walls
//   and buildings cannot be walked through (navigation/collision.js);
// - resolveStart(position) -> { position, message }: a start chosen inside a
//   building is moved outside it;
// - cameraClearance(from, to) -> 0..1: share of the way from the character to the
//   follow camera that is clear of buildings and walls (1 = clear);
// - onPose({ position, heading }) after every camera change (minimap, guidance);
//   heading is the view direction;
// - onStateChange(state): "idle" | "choosing" | "entering" | "active";
// - onManualInput(): the user moved or turned (keys, on-screen pad or look);
// - steer({ position, heading, forward, deltaSeconds }) -> degrees to turn this
//   frame (route assist while walking forward in a navigation session);
// - open(position, { heading }), close({ restoreCamera, message }), getPose()
//   and setPose(position, heading) for live navigation.
// The frame loop runs only while a movement key or button is held (or the camera
// or the character's turn is still settling), so an idle view does not re-render
// the map; the character's idle animation repaints at a low rate. Every input
// listener used while walking is removed when Walk Mode ends, with the character.
const EYE_HEIGHT_METERS = 1.65;
const LOOK_AHEAD_METERS = 16;
const WALK_SPEED_METERS_PER_SECOND = 4.5;
const SHIFT_SPEED_MULTIPLIER = 2; // Shift: 9 m/s
const JUMP = { speed: 5.2, gravity: 16 }; // take-off m/s, m/s² (about 0.85 m high, 0.65 s in the air)
const TURN_SPEED_DEGREES_PER_SECOND = 105;
const MOUSE_SENSITIVITY = 0.16;
const TOUCH_LOOK_SENSITIVITY = 0.28;
const DESCENT_DURATION_MS = 1800;
const BLOCKED_HINT_INTERVAL_MS = 5000;
const PITCH_LIMITS = [-50, 40]; // degrees; positive looks up
const VIEW_BLEND_SECONDS = 0.45;
const FACING_RATE = 12; // how fast the character turns to its walking direction (1/s)
const FOLLOW = {
  distance: 4.4, // metres behind the character while walking
  runDistance: 5.4, // and while running
  elevation: 17, // degrees above the character, looking level
  targetHeight: 1.45, // metres above the floor the camera looks at
  minDistance: 0.9, // closest the camera comes when a wall is behind the character
  margin: 1.0 // kept between the camera and a wall: clear of the floor slabs and eaves of building models
};
const STORAGE_KEY = "bcsir-walk-mode";
const DEG = Math.PI / 180;

// Label and accessible name of the toggle in each state.
const TOGGLE_TEXT = {
  idle: { label: "Walk", aria: "Walk: choose a character and a location on the map to walk from" },
  picking: { label: "Walk", aria: "Close the character picker" },
  choosing: { label: "Click a location", aria: "Cancel choosing a walk location" },
  active: { label: "Exit", aria: "Exit walk mode" }
};

const MOVEMENT_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "ShiftLeft", "ShiftRight", "Space"
]);

function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function normalizedHeading(value) {
  return ((Number(value) || 0) % 360 + 360) % 360;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const angleDelta = (from, to) => ((to - from) % 360 + 540) % 360 - 180;
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

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

const metresBetween = (a, b) => Math.hypot((b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (b[1] - a[1]) * 110574);

function readPreferences() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {}; } catch { return {}; }
}
function savePreferences(value) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* the choice lasts for this page only */ }
}

// Small figure of a character for the picker, in its colours.
function characterIcon({ colors = {}, icon = null }) {
  const palette = icon || colors;
  const c = (name, fallback) => palette[name] || fallback;
  if (palette.figure === "coat") {
    // Long hair and a long coat.
    return `<svg viewBox="0 0 34 56" aria-hidden="true">
    <path d="M10.5 9.5a6.5 7 0 0 1 13 0V19h-3.5v-4h-6v4h-3.5Z" fill="${c("Hair", "#2a1d17")}"/><circle cx="17" cy="8" r="5.2" fill="${c("Skin", "#d9a07e")}"/><path d="M11.8 6.8a5.4 5.4 0 0 1 10.4 0c-1.5-1.9-8.9-1.9-10.4 0Z" fill="${c("Hair", "#2a1d17")}"/>
    <path d="M9.5 15h15l3 14h-3l-1.2-7 1.7 24H9l1.7-24-1.2 7h-3Z" fill="${c("Shirt", "#c9b48a")}"/>
    <path d="M12.5 46h3.2l-.2 5.5h-3.2Zm5.8 0h3.2l.2 5.5h-3.2Z" fill="${c("Skin", "#d9a07e")}"/>
    <path d="M11.8 51.5h4.4v3h-5.2Zm6 0h4.4l.8 3h-5.2Z" fill="${c("Shoes", "#3a2f2a")}"/></svg>`;
  }
  return `<svg viewBox="0 0 34 56" aria-hidden="true">
    <circle cx="17" cy="7.5" r="5.5" fill="${c("Skin", "#a8744f")}"/><path d="M11.6 6.6a5.5 5.5 0 0 1 10.8 0c-1.6-1.8-9.2-1.8-10.8 0Z" fill="${c("Hair", "#17110d")}"/>
    <path d="M9 15h16l2.5 15h-3.2L23 20v12H11V20l-1.3 10H6.5Z" fill="${c("Shirt", "#2f6db0")}"/>
    <path d="M11 32h12l-.6 20h-4.2L17 38l-1.2 14h-4.2Z" fill="${c("Trousers", "#2a2e36")}"/>
    <path d="M10.8 51.5h5.4v3h-6.2Zm7 0h5.4l.8 3h-6.2Z" fill="${c("Shoes", "#1b1b1b")}"/></svg>`;
}

export function createWalkMode({
  map,
  onToast,
  beforeOpen,
  getFloorElevation = () => 0,
  getLevelLabel = () => "Floor",
  resolveMove = null,
  resolveStart = null,
  cameraClearance = null,
  onPose = null,
  onStateChange = null,
  onManualInput = null,
  steer = null,
  characters = WALK_CHARACTERS
} = {}) {
  const toggle = document.querySelector("#walk-mode");
  const toggleLabel = toggle?.querySelector(".walk-button-label");
  const panel = document.querySelector("#walk-panel");
  const closeButton = document.querySelector("#walk-close");
  const viewButton = document.querySelector("#walk-view");
  const eyebrow = document.querySelector("#walk-eyebrow");
  const lookSurface = document.querySelector("#walk-look-surface");
  const reticle = document.querySelector("#walk-reticle");
  const heightReadout = document.querySelector("#walk-height");
  const headingReadout = document.querySelector("#walk-heading");
  const picker = document.querySelector("#walk-picker");
  const pickerCharacters = document.querySelector("#walk-picker-characters");
  const pickerTitle = document.querySelector("#walk-picker-title");
  const pickerStart = document.querySelector("#walk-picker-start");
  const pickerClose = document.querySelector("#walk-picker-close");

  if (!map || !toggle || !panel || !lookSurface) {
    return { isActive: () => false, isChoosing: () => false, cancelChoosing: () => {}, open: () => {}, close: () => {}, getPose: () => null, setPose: () => {} };
  }

  const interactionNames = ["boxZoom", "doubleClickZoom", "dragPan", "dragRotate", "keyboard", "scrollZoom", "touchZoomRotate"];
  const pressed = new Set();
  const player = { position: null, heading: 0 };
  const saved = readPreferences();
  let characterId = characters.some((item) => item.id === saved.character) ? saved.character : characters[0]?.id;
  let view = "third"; // reset to third person at every start (enterAt)
  let blend = 1; // camera: 0 first person, 1 third person
  let pitch = 0; // look up/down, degrees
  let facing = 0; // the character's facing, degrees
  let facingTarget = null; // where the character turns to: the way he walks
  let speed = 0; // measured walking speed, m/s
  let running = false;
  const jump = { height: 0, velocity: 0, held: false }; // metres above the floor, m/s; Space still down since the take-off
  let followDistance = 0; // current horizontal distance of the follow camera
  let lastSetPose = null; // { position, time } of the last setPose (GPS)
  const character = characters.length ? createWalkCharacter(map, { onError: () => onToast?.("The character could not be loaded; walking continues without it.") }) : null;
  const sky = createWalkSky(map);
  let active = false;
  let choosing = false; // waiting for a click on the map
  let picking = false; // the character picker is open
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
  let previousPointerY = 0;
  let lastBlockedHint = { id: null, time: 0 };
  let session = null; // AbortController of the listeners used while walking

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

  // ---- Cameras ------------------------------------------------------------------------
  // First person: eye height above the active floor, looking `pitch` up or down.
  function firstPersonView() {
    const eyeAltitude = floorElevation() + jump.height + EYE_HEIGHT_METERS;
    const ahead = offsetFromHeading(player.position, player.heading, 0, LOOK_AHEAD_METERS);
    return { from: player.position, fromAltitude: eyeAltitude, to: ahead, toAltitude: eyeAltitude + (pitch ? LOOK_AHEAD_METERS * Math.tan(pitch * DEG) : 0) };
  }

  // MapLibre keeps a camera's target and clamps its zoom to the map's maximum, which
  // moves a camera placed closer to its target than that zoom allows back along its
  // line of sight. By how much (1: not at all):
  function zoomStretch(from, fromAltitude, to, toAltitude) {
    const { zoom } = map.calculateCameraOptionsFromTo(from, fromAltitude, to, toAltitude);
    return 2 ** Math.max(0, zoom - map.getMaxZoom());
  }

  // Camera options that keep the camera at `from`: aimed at a point farther along the
  // same line of sight when the zoom limit would move it.
  function cameraFromTo(from, fromAltitude, to, toAltitude) {
    const stretch = zoomStretch(from, fromAltitude, to, toAltitude);
    if (stretch <= 1) return map.calculateCameraOptionsFromTo(from, fromAltitude, to, toAltitude);
    const k = stretch * 1.01;
    const target = { lng: from.lng + (to.lng - from.lng) * k, lat: from.lat + (to.lat - from.lat) * k };
    return map.calculateCameraOptionsFromTo(from, fromAltitude, target, fromAltitude + (toAltitude - fromAltitude) * k);
  }

  // Third person: behind and above the character, looking at a point just ahead of
  // it. The camera stays as far back as the map's zoom limit has always put it (the
  // offset below, moved back along the line of sight: several metres, more on taller
  // screens), pulled in when a building or wall is in the way (at once), easing back
  // out when the way clears.
  function thirdPersonView(deltaSeconds = 0) {
    const floor = floorElevation() + jump.height;
    const elevation = clamp(FOLLOW.elevation - pitch, 2, 65) * DEG;
    const wanted = running ? FOLLOW.runDistance : FOLLOW.distance;
    const horizontal = wanted * Math.cos(elevation);
    const lead = 0.8; // metres ahead of the character the camera looks at
    const to = offsetFromHeading(player.position, player.heading, 0, lead);
    const toAltitude = floor + FOLLOW.targetHeight + (pitch > 0 ? Math.tan(pitch * DEG) * 3 : 0);
    const offsetAltitude = floor + FOLLOW.targetHeight + wanted * Math.sin(elevation);
    // On the line of sight, k = 0 at the target and 1 at the offset: metres behind the character.
    const behind = (k) => (horizontal + lead) * k - lead;
    const reach = behind(zoomStretch(offsetFromHeading(player.position, player.heading, 0, -horizontal), offsetAltitude, to, toAltitude));
    const position = [player.position.lng, player.position.lat];
    const back = offsetFromHeading(player.position, player.heading, 0, -reach);
    const clear = cameraClearance ? clamp(Number(cameraClearance(position, [back.lng, back.lat])) || 0, 0, 1) : 1;
    const allowed = clear < 1 ? Math.max(FOLLOW.minDistance, clear * reach - FOLLOW.margin) : reach;
    if (!followDistance || allowed < followDistance) followDistance = allowed;
    else followDistance += (allowed - followDistance) * (1 - Math.exp(-deltaSeconds * 3));
    const k = (followDistance + lead) / (horizontal + lead);
    return {
      from: offsetFromHeading(player.position, player.heading, 0, -followDistance),
      fromAltitude: toAltitude + (offsetAltitude - toAltitude) * k,
      to,
      toAltitude
    };
  }

  function cameraOptions(deltaSeconds = 0) {
    const b = smooth(clamp(blend, 0, 1));
    const first = firstPersonView();
    if (b <= 0) return cameraFromTo(first.from, first.fromAltitude, first.to, first.toAltitude);
    const third = thirdPersonView(deltaSeconds);
    const mix = (key) => ({ lng: lerp(first[key].lng, third[key].lng, b), lat: lerp(first[key].lat, third[key].lat, b) });
    return cameraFromTo(mix("from"), lerp(first.fromAltitude, third.fromAltitude, b), mix("to"), lerp(first.toAltitude, third.toAltitude, b));
  }

  function updateCharacter() {
    if (!character || !player.position) return;
    character.setVisible(blend > 0.35);
    character.update({ position: [player.position.lng, player.position.lat], altitude: floorElevation() + jump.height, facing, speed, running, airborne: jump.height > 0.05 });
  }

  function updateCamera(deltaSeconds = 0) {
    if (!active || !player.position) return;
    map.jumpTo(cameraOptions(deltaSeconds), { walkMode: true });
    updateCharacter();
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

  // Returns the metres actually moved.
  function movePlayer(rightMeters, forwardMeters) {
    if (!active || !player.position || (!rightMeters && !forwardMeters)) return 0;
    const target = offsetFromHeading(player.position, player.heading, rightMeters, forwardMeters);
    const from = [player.position.lng, player.position.lat];
    if (!resolveMove) { player.position = target; return Math.hypot(rightMeters, forwardMeters); }
    const result = resolveMove(from, [target.lng, target.lat]);
    const next = toArray(result?.position ?? result) || from;
    const wanted = Math.hypot(rightMeters, forwardMeters);
    const moved = metresBetween(from, next);
    player.position = { lng: next[0], lat: next[1] };
    if (result?.blocked && moved < wanted * 0.3) notifyBlocked(result.blocker);
    return moved;
  }

  function rotatePlayer(degrees) {
    if (!active || !degrees) return;
    player.heading = normalizedHeading(player.heading + degrees);
    if (view === "first") facing = player.heading;
  }

  function look(dx, dy, sensitivity) {
    onManualInput?.();
    rotatePlayer(dx * sensitivity);
    if (dy) pitch = clamp(pitch - dy * sensitivity, PITCH_LIMITS[0], PITCH_LIMITS[1]);
    updateCamera();
  }

  // Still settling after the keys are released: the view blend, the character's turn,
  // the follow camera easing back out, the walk slowing to a stop.
  function settling() {
    const viewTarget = view === "third" ? 1 : 0;
    return blend !== viewTarget || Math.abs(speed) > 0.05 || jump.height > 0 || jump.velocity !== 0 || (view === "third" && Math.abs(angleDelta(facing, facingTarget ?? facing)) > 0.5);
  }

  function frame(time) {
    animationFrame = 0;
    if (!active) return;
    if (!previousFrameTime) previousFrameTime = time;
    const deltaSeconds = Math.min(0.05, (time - previousFrameTime) / 1000);
    previousFrameTime = time;

    const shift = pressed.has("ShiftLeft") || pressed.has("ShiftRight");
    const speedBoost = shift ? SHIFT_SPEED_MULTIPLIER : 1;
    let forward = 0;
    let right = 0;
    let turn = 0;

    if (pressed.has("KeyW") || pressed.has("ArrowUp")) forward += 1;
    if (pressed.has("KeyS") || pressed.has("ArrowDown")) forward -= 1;
    if (pressed.has("KeyA")) right -= 1;
    if (pressed.has("KeyD")) right += 1;
    if (pressed.has("KeyQ") || pressed.has("ArrowLeft")) turn -= 1;
    if (pressed.has("KeyE") || pressed.has("ArrowRight")) turn += 1;

    // Jump: once per press of Space, from the floor; up and down under gravity.
    if (pressed.has("Space") && !jump.held && jump.height <= 0) { jump.velocity = JUMP.speed; jump.held = true; }
    if (!pressed.has("Space")) jump.held = false;
    if (jump.velocity || jump.height > 0) {
      jump.velocity -= JUMP.gravity * deltaSeconds;
      jump.height += jump.velocity * deltaSeconds;
      if (jump.height <= 0 && jump.velocity < 0) { jump.height = 0; jump.velocity = 0; } // landed (not the take-off frame)
    }

    const magnitude = Math.hypot(right, forward) || 1;
    const distance = WALK_SPEED_METERS_PER_SECOND * speedBoost * deltaSeconds;
    const assist = forward > 0 && !turn && !draggingLook ? Number(steer?.({ ...pose(), forward, deltaSeconds })) || 0 : 0;
    const moved = movePlayer(right / magnitude * distance, forward / magnitude * distance);
    rotatePlayer(turn * TURN_SPEED_DEGREES_PER_SECOND * deltaSeconds + assist);

    // Walking speed (for the animation) and the character's facing: the way he walks.
    const measured = deltaSeconds > 0 ? moved / deltaSeconds : 0;
    speed += (measured - speed) * Math.min(1, deltaSeconds * 12);
    if (speed < 0.05 && !moved) speed = 0;
    running = shift && moved > 0;
    if (view === "first") facing = player.heading;
    else {
      if (right || forward) facingTarget = normalizedHeading(player.heading + Math.atan2(right, forward) / DEG);
      if (facingTarget !== null) facing = normalizedHeading(facing + angleDelta(facing, facingTarget) * (1 - Math.exp(-deltaSeconds * FACING_RATE)));
    }
    // View blend towards the chosen view.
    const viewTarget = view === "third" ? 1 : 0;
    blend = viewTarget > blend ? Math.min(viewTarget, blend + deltaSeconds / VIEW_BLEND_SECONDS) : Math.max(viewTarget, blend - deltaSeconds / VIEW_BLEND_SECONDS);

    updateCamera(deltaSeconds);

    if (hasMovementInput() || settling()) animationFrame = requestAnimationFrame(frame);
    else { previousFrameTime = 0; speed = 0; running = false; updateCharacter(); }
  }

  function hasMovementInput() {
    for (const code of pressed) if (!code.startsWith("Shift")) return true;
    return false;
  }

  // Starts the frame loop if it is not running (keys held down keep it going).
  function wake(force = false) {
    if (active && !animationFrame && (force || hasMovementInput())) animationFrame = requestAnimationFrame(frame);
  }

  // ---- Views -----------------------------------------------------------------------------
  function showView() {
    const third = view === "third";
    if (viewButton) {
      viewButton.textContent = third ? "3rd person" : "1st person";
      viewButton.setAttribute("aria-pressed", String(third));
      viewButton.setAttribute("aria-label", third ? "Third-person view: switch to first person (V)" : "First-person view: switch to third person (V)");
    }
    if (eyebrow) eyebrow.textContent = third ? "Third person" : "First person";
  }

  function setView(next) {
    if (next !== "third" && next !== "first") return;
    view = next;
    if (view === "first") facing = player.heading;
    else { facing = player.heading; facingTarget = null; followDistance = 0; }
    showView();
    wake(true);
  }

  // ---- Picker ----------------------------------------------------------------------------
  function renderPicker() {
    if (!pickerCharacters) return;
    if (pickerTitle) pickerTitle.textContent = "Choose your character";
    pickerCharacters.innerHTML = characters.map((item) => `<label><input type="radio" name="walk-picker-character" value="${item.id}"${item.id === characterId ? " checked" : ""} /><span class="walk-picker-card">${characterIcon(item)}<span>${item.name}</span></span></label>`).join("");
  }

  // With one character there is nothing to choose: straight to the location.
  function openPicker() {
    if (!picker || characters.length < 2) { startChoosing(); return; }
    picking = true;
    renderPicker();
    picker.hidden = false;
    setToggleState("picking");
    (picker.querySelector('input[name="walk-picker-character"]:checked') || pickerStart)?.focus();
  }

  function closePicker({ restoreFocus = true } = {}) {
    if (!picking) return;
    picking = false;
    picker.hidden = true;
    setToggleState("idle");
    if (restoreFocus) toggle.focus();
  }

  function confirmPicker() {
    const chosen = picker?.querySelector('input[name="walk-picker-character"]:checked')?.value;
    if (chosen) characterId = chosen;
    savePreferences({ character: characterId });
    closePicker({ restoreFocus: false });
    startChoosing();
  }

  const chosenCharacter = () => characters.find((item) => item.id === characterId) || characters[0];

  // ---- Entering and leaving ------------------------------------------------------------
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
    toggle.setAttribute("aria-expanded", String(state === "picking"));
    toggle.setAttribute("aria-label", text.aria);
    if (toggleLabel) toggleLabel.textContent = text.label;
  }

  // Step 1 (after the picker): wait for the user to click the location to walk from.
  function startChoosing() {
    if (choosing || active || entering) return;
    if (beforeOpen?.() === false) return;
    choosing = true;
    document.documentElement.classList.add("walk-choosing");
    setToggleState("choosing");
    onToast?.("Click a location on the map to go down into walk mode. Press Esc to cancel.");
    emitState();
  }

  function cancelChoosing() {
    if (!choosing) return;
    choosing = false;
    document.documentElement.classList.remove("walk-choosing");
    setToggleState("idle");
    emitState();
  }

  // Step 2: the camera goes down to the chosen location, then walking starts.
  function enterAt(position, { heading = null } = {}) {
    if (active || entering) return;
    closePicker({ restoreFocus: false });
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
    facing = player.heading;
    facingTarget = null;
    pitch = 0;
    speed = 0;
    running = false;
    Object.assign(jump, { height: 0, velocity: 0, held: false });
    followDistance = 0;
    view = "third";
    blend = 1;
    entering = true;
    sky.show();
    const id = ++descent;
    document.documentElement.classList.add("walk-mode-active");
    setToggleState("active");
    showView();
    if (character && view === "third") { character.show(chosenCharacter()); updateCharacter(); }
    emitState();
    map.once("moveend", () => { if (id === descent && entering) activate(); });
    map.easeTo({ ...cameraOptions(), duration: DESCENT_DURATION_MS, essential: true }, { walkMode: true });
  }

  function activate() {
    entering = false;
    active = true;
    pressed.clear();
    previousFrameTime = 0;
    panel.hidden = false;
    lookSurface.hidden = false;
    if (reticle) reticle.hidden = false;
    if (character) character.show(chosenCharacter());
    listenWhileWalking();
    updateCamera();
    onToast?.(window.matchMedia?.("(pointer: coarse)").matches
      ? "Walk mode on — hold the arrow buttons to walk, Jump to jump, drag the view to look around."
      : "Walk mode on — W/A/S/D or arrows to walk, mouse to look, Shift to run, Space to jump. V switches the view, Esc exits.");
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
    session?.abort();
    session = null;
    character?.hide();
    sky.hide();
    speed = 0;
    running = false;
    Object.assign(jump, { height: 0, velocity: 0, held: false });
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

  // ---- Listeners -------------------------------------------------------------------------
  // Always: the toggle, the picker, the map click while choosing, Esc.
  toggle.addEventListener("click", () => {
    if (active || entering) exit();
    else if (choosing) cancelChoosing();
    else if (picking) closePicker();
    else openPicker();
  });
  closeButton?.addEventListener("click", () => exit());
  pickerStart?.addEventListener("click", confirmPicker);
  pickerClose?.addEventListener("click", () => closePicker());
  picker?.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target.matches?.("input")) { event.preventDefault(); confirmPicker(); } });

  // A click (not a drag) on the map while choosing picks the location.
  map.on("click", (event) => { if (choosing) enterAt(event.lngLat); });

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || isTypingTarget(event.target)) return;
    if (picking) { event.preventDefault(); closePicker(); return; }
    if (choosing) { event.preventDefault(); cancelChoosing(); return; }
    if (active || entering) { event.preventDefault(); exit(); }
  });

  // Only while walking (removed by exit()): movement keys, V, looking, the pad.
  function listenWhileWalking() {
    session?.abort();
    session = new AbortController();
    const options = { signal: session.signal };

    window.addEventListener("keydown", (event) => {
      if (!active || isTypingTarget(event.target)) return;
      if (event.code === "KeyV" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setView(view === "third" ? "first" : "third");
        return;
      }
      if (!MOVEMENT_KEYS.has(event.code)) return;
      event.preventDefault();
      if (!pressed.has(event.code) && !event.code.startsWith("Shift")) onManualInput?.();
      pressed.add(event.code);
      wake();
    }, options);

    window.addEventListener("keyup", (event) => {
      if (!active || !MOVEMENT_KEYS.has(event.code)) return;
      event.preventDefault();
      pressed.delete(event.code);
    }, options);

    window.addEventListener("blur", () => pressed.clear(), options);

    viewButton?.addEventListener("click", () => setView(view === "third" ? "first" : "third"), options);

    panel.querySelectorAll("[data-walk-key]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        if (!active) return;
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        setControlPressed(button, true);
      }, options);
      button.addEventListener("pointerup", () => setControlPressed(button, false), options);
      button.addEventListener("lostpointercapture", () => setControlPressed(button, false), options);
      button.addEventListener("pointercancel", () => setControlPressed(button, false), options);
      // A long press on a phone must not open the context menu.
      button.addEventListener("contextmenu", (event) => event.preventDefault(), options);
    });

    lookSurface.addEventListener("pointerdown", (event) => {
      if (!active) return;
      event.preventDefault();
      draggingLook = true;
      previousPointerX = event.clientX;
      previousPointerY = event.clientY;
      lookSurface.setPointerCapture?.(event.pointerId);
      if (event.pointerType === "mouse") {
        try {
          const pointerLockRequest = lookSurface.requestPointerLock?.();
          pointerLockRequest?.catch?.(() => { /* drag-to-look remains available */ });
        } catch (_) { /* drag-to-look remains available */ }
      }
    }, options);

    lookSurface.addEventListener("pointermove", (event) => {
      if (!active || !draggingLook || document.pointerLockElement === lookSurface) return;
      const dx = event.clientX - previousPointerX, dy = event.clientY - previousPointerY;
      previousPointerX = event.clientX;
      previousPointerY = event.clientY;
      if (!dx && !dy) return;
      look(dx, dy, event.pointerType === "mouse" ? MOUSE_SENSITIVITY : TOUCH_LOOK_SENSITIVITY);
    }, options);

    lookSurface.addEventListener("lostpointercapture", () => { draggingLook = false; }, options);
    lookSurface.addEventListener("pointercancel", () => { draggingLook = false; }, options);

    document.addEventListener("mousemove", (event) => {
      if (!active || document.pointerLockElement !== lookSurface || (!event.movementX && !event.movementY)) return;
      look(event.movementX, event.movementY, MOUSE_SENSITIVITY);
    }, options);
  }

  showView();

  return {
    isActive: () => active || entering,
    isChoosing: () => choosing,
    cancelChoosing,
    open: (position, options) => enterAt(position || map.getCenter(), options),
    close: exit,
    getPose: pose,
    // Diagnostics: current view, look pitch, character state.
    getView: () => ({ view, blend, pitch, facing, speed, running, jump: jump.height, sky: sky.isShown(), followDistance, character: character?.stats() ?? null, listening: Boolean(session) }),
    setView,
    // Live navigation drives the walker from GPS and the compass.
    setPose(position, heading) {
      const next = toArray(position);
      if (!active || !next) return;
      const now = performance.now();
      if (lastSetPose && player.position) {
        const seconds = (now - lastSetPose.time) / 1000;
        speed = seconds > 0 ? Math.min(3, metresBetween(lastSetPose.position, next) / seconds) : speed;
      }
      lastSetPose = { position: next, time: now };
      player.position = { lng: next[0], lat: next[1] };
      if (Number.isFinite(heading)) player.heading = normalizedHeading(heading);
      facing = player.heading;
      running = false;
      updateCamera();
    }
  };
}
