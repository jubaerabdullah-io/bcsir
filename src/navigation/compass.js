// Phone compass for live navigation.
//
// - iOS asks for permission (DeviceOrientationEvent.requestPermission), and only
//   from a tap: start() must be called directly in the click handler.
// - Only absolute readings are a compass: iOS webkitCompassHeading, or
//   `deviceorientationabsolute` / event.absolute on Android. A relative
//   `deviceorientation` (alpha measured from wherever the phone was at start) is
//   ignored, and the status becomes "unavailable" when nothing usable arrives.
// - Lying flat, the heading is where the top of the phone points; held upright,
//   where its back camera looks. Landscape screens are corrected.
// - iOS reports accuracy; above 30° (or negative: not calibrated) the status is
//   "inaccurate" and the navigation falls back to the walking direction.
// Status: "off" | "requesting" | "live" | "inaccurate" | "unavailable" | "denied".
const WAIT_FOR_READING_MS = 2500;
const MAX_ACCURACY_DEG = 30;
const DEG = Math.PI / 180;

const normalize = (value) => ((value % 360) + 360) % 360;
const screenAngle = () => Number(screen.orientation?.angle ?? window.orientation ?? 0) || 0;

// Heading of the direction the back camera looks (phone held upright).
function cameraHeading(alpha, beta, gamma) {
  const a = alpha * DEG, b = beta * DEG, g = gamma * DEG;
  const east = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const north = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  return normalize(Math.atan2(east, north) / DEG);
}

export function headingFromOrientation(event) {
  if (Number.isFinite(event?.webkitCompassHeading)) {
    const accuracy = Number.isFinite(event.webkitCompassAccuracy) ? event.webkitCompassAccuracy : null;
    return { heading: normalize(event.webkitCompassHeading + screenAngle()), accuracy };
  }
  const absolute = event?.absolute === true || event?.type === "deviceorientationabsolute";
  if (!absolute || !Number.isFinite(event.alpha)) return null;
  const beta = Number(event.beta) || 0, gamma = Number(event.gamma) || 0;
  const upright = Math.abs(beta) > 50 && Math.abs(beta) < 130;
  return { heading: upright ? cameraHeading(event.alpha, beta, gamma) : normalize(360 - event.alpha + screenAngle()), accuracy: null };
}

export function createCompass({ onReading, onStatus } = {}) {
  let status = "off";
  let heading = null;
  let accuracy = null;
  let eventName = null;
  let waitTimer = 0;
  let received = false;

  function setStatus(next) {
    if (next === status) return;
    status = next;
    onStatus?.(status);
  }

  function handle(event) {
    const reading = headingFromOrientation(event);
    if (!reading) return;
    received = true;
    heading = reading.heading;
    accuracy = reading.accuracy;
    setStatus(accuracy !== null && (accuracy < 0 || accuracy > MAX_ACCURACY_DEG) ? "inaccurate" : "live");
    onReading?.({ heading, accuracy, status });
  }

  function listen() {
    eventName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(eventName, handle, true);
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => { if (!received) setStatus("unavailable"); }, WAIT_FOR_READING_MS);
  }

  return {
    // Call from a tap (iOS permission). Resolves to the status.
    start() {
      if (eventName) return Promise.resolve(status); // already listening
      const Orientation = window.DeviceOrientationEvent;
      if (!Orientation || !window.isSecureContext) { setStatus("unavailable"); return Promise.resolve(status); }
      let permission = null;
      if (typeof Orientation.requestPermission === "function") {
        try { permission = Orientation.requestPermission(); } catch (error) { permission = Promise.reject(error); }
      }
      setStatus("requesting");
      return Promise.resolve(permission || "granted").then((result) => {
        if (result !== "granted") { setStatus("denied"); return status; }
        listen();
        return status;
      }, () => { setStatus("denied"); return status; });
    },
    stop() {
      if (eventName) window.removeEventListener(eventName, handle, true);
      eventName = null;
      clearTimeout(waitTimer);
      received = false;
      heading = null;
      accuracy = null;
      setStatus("off");
    },
    status: () => status,
    // Usable heading (degrees), or null when the compass is off, missing or not calibrated.
    heading: () => (status === "live" ? heading : null),
    rawHeading: () => heading,
    // Test hook: feed a reading as if from the sensor.
    inject(reading) { handle({ type: "deviceorientationabsolute", absolute: true, ...reading }); }
  };
}
