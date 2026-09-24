// Route endpoint pins: a blue location pin at the start and a red one at the
// destination. They are HTML markers, so they are drawn above the map canvas
// and are never hidden behind 3D buildings. Each pin stands on the point the
// route service used for that building (its recorded entrance, or its
// footprint centre when no entrance is recorded).
import * as maplibregl from "maplibre-gl";

const PIN = (fill) => `<svg viewBox="0 0 32 42" aria-hidden="true"><path d="M16 1.5C8 1.5 1.5 7.9 1.5 15.8 1.5 26.4 16 40.5 16 40.5S30.5 26.4 30.5 15.8C30.5 7.9 24 1.5 16 1.5Z" fill="${fill}" stroke="#fff" stroke-width="2.5"/><circle cx="16" cy="15.5" r="5.6" fill="#fff"/></svg>`;
const KINDS = {
  source: { color: "#1e88e5", label: "Start" },
  destination: { color: "#e53935", label: "Destination" }
};

export function createRouteMarkers(map) {
  const markers = {};
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

  // endpoints: { source: { point, name } | null, destination: { point, name } | null }
  function set(endpoints = {}) {
    for (const kind of Object.keys(KINDS)) {
      const endpoint = endpoints[kind];
      if (endpoint?.point) {
        const pin = marker(kind);
        pin.getElement().setAttribute("aria-label", `${KINDS[kind].label}: ${endpoint.name || "selected place"}`);
        pin.getElement().title = `${KINDS[kind].label}: ${endpoint.name || ""}`.trim();
        pin.setLngLat(endpoint.point);
        if (visible) pin.addTo(map);
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
