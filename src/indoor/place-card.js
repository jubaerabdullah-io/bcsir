// Details of a room or point chosen on a floor plan: its name and kind, where it
// is (floor and building), any contact details recorded for it, and the two route
// buttons of the building card ("Start here", "Directions to here").
import { escapeHTML } from "../utils/html.js";
import { firstProperty } from "./levels.js";

const $ = (selector) => document.querySelector(selector);

// Facts shown when the feature has them (first matching property, case-insensitive).
const FACTS = [
  ["Room", ["room_number", "unit_number", "room_no", "number"]],
  ["Phone", ["phone", "telephone", "contact"]],
  ["Hours", ["hours", "opening_hours", "open"]],
  ["Email", ["email"]],
  ["Contact", ["person", "contact_person", "in_charge"]]
];

// onSetSource(place) / onSetDestination(place) receive the shown place.
export function createPlaceCard({ onClose, onSetSource, onSetDestination }) {
  const card = $("#place-card");
  let shown = null;
  let route = { source: null, destination: null }; // place uids

  function refreshActions() {
    const role = shown && route.source === shown.uid ? "source" : shown && route.destination === shown.uid ? "destination" : "";
    const source = $("#place-set-source"), destination = $("#place-set-destination");
    source.classList.toggle("active-route-action", role === "source");
    destination.classList.toggle("active-route-action", role === "destination");
    source.querySelector(".route-label").textContent = role === "source" ? "Starting point" : "Start here";
    destination.querySelector(".route-label").textContent = role === "destination" ? "Destination" : "Directions to here";
  }

  // place: a room or point of indoor-model.js; where: { building, level, sample }
  // (names of its building and floor).
  function show(place, where) {
    shown = place;
    const p = place.properties || {};
    $("#place-name").textContent = place.name || place.classLabel || "Place";
    const bangla = firstProperty(p, ["name_bn"]);
    $("#place-name-bn").textContent = bangla || "";
    $("#place-name-bn").hidden = !bangla;
    $("#place-class").textContent = place.classLabel || (place.kind === "unit" ? "Room" : "Point");
    $("#place-where").innerHTML = `<strong>${escapeHTML(where.level)}</strong> · ${escapeHTML(where.building)}`;
    const icon = $("#place-icon");
    icon.textContent = (place.classLabel || place.name || "?").slice(0, 1).toUpperCase();
    icon.style.background = place.kind === "unit" ? place.color : "";
    icon.dataset.kind = place.kind;
    const facts = FACTS.map(([label, keys]) => [label, firstProperty(p, keys)]).filter(([, value]) => value !== undefined);
    const description = firstProperty(p, ["description", "details", "note"]);
    const list = $("#place-facts");
    list.innerHTML = facts.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join("") + (description !== undefined ? `<div class="place-description"><dt>About</dt><dd>${escapeHTML(description)}</dd></div>` : "");
    list.hidden = !list.innerHTML;
    $("#place-sample").hidden = !where.sample;
    refreshActions();
    card.hidden = false;
    card.scrollTop = 0;
  }

  function hide() { shown = null; card.hidden = true; }

  $("#place-card-close").addEventListener("click", () => onClose?.());
  $("#place-set-source").addEventListener("click", () => shown && onSetSource?.(shown));
  $("#place-set-destination").addEventListener("click", () => shown && onSetDestination?.(shown));

  return {
    show,
    hide,
    shownUid: () => shown?.uid ?? null,
    // uids of the route's start and destination places (or null), for the button labels.
    setRoute(next) { route = next || { source: null, destination: null }; refreshActions(); }
  };
}
