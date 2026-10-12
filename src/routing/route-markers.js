// Route endpoint pins: a blue location pin at the start and a red one at the
// destination. They are HTML markers, so they are drawn above the map canvas
// and are never hidden behind 3D buildings.
//
// A pin on a building stands on top of it: above the middle of its roof, not at
// its entrance down on the road (in the walking view a pin on the ground stood in
// the middle of the road in front of the building). A pin on a room stands on the
// room, at its floor's height in the building. The caller gives each pin its point
// and its `height` above the ground (app.js showRoutePins); MapLibre's markers know
// no height, so the pin is moved up the screen by as much as the camera makes of
// that height, and follows the camera (map/altitude.js). A pin without a height
// (the visitor's own position) stands on the ground.
import * as maplibregl from "maplibre-gl";
import { STYLE } from "../core/config.js";
import { BADGE_RADIUS } from "../buildings/building-labels.js";
import { elevateMarker } from "../map/altitude.js";

const PIN = (fill) => `<svg viewBox="0 0 32 42" aria-hidden="true"><path d="M16 1.5C8 1.5 1.5 7.9 1.5 15.8 1.5 26.4 16 40.5 16 40.5S30.5 26.4 30.5 15.8C30.5 7.9 24 1.5 16 1.5Z" fill="${fill}" stroke="#fff" stroke-width="2.5"/><circle cx="16" cy="15.5" r="5.6" fill="#fff"/></svg>`;
const KINDS = {
  source: { color: STYLE.pinSource, label: "Start" },
  destination: { color: STYLE.pinDestination, label: "Destination" }
};
// On a roof the building's photo badge is at the same point: the pin's point
// touches the top of the badge, as the pin of a selected building does (building-pin.js).
const ON_BADGE_OFFSET = [0, -(BADGE_RADIUS - 2)];

export function createRouteMarkers(map) {
  const markers = {};
  const lower = {}; // kind -> puts that pin back on the ground (elevateMarker)
  let visible = true;

  function marker(kind) {
    if (markers[kind]) return markers[kind];
    const element = document.createElement("div");
    element.className = `route-pin route-pin-${kind}`;
    element.innerHTML = PIN(KINDS[kind].color);
    element.setAttribute("role", "img");
    markers[kind] = new maplibregl.Marker({ element, anchor: "bottom" });
    return markers[kind];
  }

  // endpoints: { source, destination }, each { point, name, height?, onBadge? } or null.
  // height: metres above the ground the pin stands at; onBadge: the building's
  // photo badge is at that point, and the pin stands on it.
  function set(endpoints = {}) {
    for (const kind of Object.keys(KINDS)) {
      const endpoint = endpoints[kind];
      lower[kind]?.();
      lower[kind] = null;
      if (endpoint?.point) {
        const pin = marker(kind);
        pin.getElement().setAttribute("aria-label", `${KINDS[kind].label}: ${endpoint.name || "selected place"}`);
        pin.getElement().title = `${KINDS[kind].label}: ${endpoint.name || ""}`.trim();
        pin.setLngLat(endpoint.point);
        pin.setOffset(endpoint.onBadge ? ON_BADGE_OFFSET : [0, 0]);
        if (visible) pin.addTo(map);
        const height = Number(endpoint.height) || 0;
        if (height > 0) lower[kind] = elevateMarker(map, pin, height);
      } else {
        markers[kind]?.remove();
      }
      if (markers[kind]) markers[kind].__point = endpoint?.point || null;
    }
  }

  function setVisible(next) {
    visible = next;
    for (const pin of Object.values(markers)) {
      if (next && pin.__point) pin.addTo(map); else pin.remove();
    }
  }

  return { set, setVisible };
}
