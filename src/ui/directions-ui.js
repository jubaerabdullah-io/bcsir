// Directions panel: From / To fields and the route under them.
//
// The panel takes the place of the search box: it opens from the Directions
// button of the search box or of a card ("Directions", "Start here"), and its
// Close button clears the route and brings the search box back.
//
// Both fields autocomplete from the campus directory and list the places used
// last before anything is typed. The From field offers buildings, rooms and
// laboratories; the To field also offers testing services. A laboratory or test
// is routed to the building recorded for it (see directory.js). If no building
// is recorded, it says so and sets no endpoint. While the panel is open and a
// field is empty, a click on a building (or on a room of an open floor) fills it.
// The From field also offers "Your location" first: the route then starts where
// the visitor stands (the browser asks for the position).
//
// The panel does not calculate routes. It sets the endpoints through the
// existing interaction controller (setSourceFeature / setDestinationFeature),
// and app.js routes with the original BCSIR routing service as before.
// The Walk chip is the travel-mode toggle: when it is on (the default) the
// walking route is drawn; when it is off the endpoints stay selected but no
// route is drawn.
//
// On touch screens a tapped field is emptied for typing (the chosen place stays
// as its placeholder), and choosing a result moves on to the other field if it
// is still empty, otherwise it closes the on-screen keyboard.
import { createCombobox, resultItemHTML } from "../search/combobox.js";
import { escapeHTML } from "../utils/html.js";

const KINDS = ["source", "destination"];
const ROLE = { source: "starting point", destination: "destination" };
// The visitor's own position as the starting point (it is not a place of the directory).
const LOCATION_ENTRY = Object.freeze({ kind: "location", key: "location", title: "Your location", subtitle: "", meta: "Start from where you are" });
const LOCATION_WORDS = ["your location", "my location", "current location"];
const ENTRY_KINDS = { source: ["building", "place", "lab"], destination: ["building", "place", "lab", "test"] };

// onNavigate(view) starts live guidance ("map") or the first-person 3D mode
// ("walk") on the drawn route; the Start / 3D mode buttons show only when a
// walking route is drawn (description.navigable).
// onStep(step) shows a step of an indoor route; onStepFreeChange(on) recalculates
// the route with or without stairs.
// getRecent({ kinds, exclude }) lists the places used last; onUse(entry) is called
// with each place chosen as an endpoint.
// onPick(handler) hands the next building or room clicked on the map to
// handler(feature, entry); null stops that.
// onUseLocation() makes the visitor's position the starting point; it resolves to
// false when the position is not known.
export function createDirections({ getDirectory, getRecent, resolveFeature, onSetEndpoint, onClearEndpoint, onSwap, onClearRoute, onPick, onWalkChange, onMessage, onNavigate, onStep, onStepFreeChange, onUse, onUseLocation }) {
  const panel = document.querySelector("#directions");
  const appTop = panel.closest(".app-top");
  const walk = document.querySelector("#walk-toggle");
  const summary = document.querySelector("#route-summary-box");
  const headline = document.querySelector("#route-headline");
  const detail = document.querySelector("#route-detail");
  const more = document.querySelector("#route-more");
  const moreLabel = document.querySelector("#route-more-label");
  const routeActions = document.querySelector("#route-actions");
  const swap = document.querySelector("#direction-swap");
  const inputs = { source: document.querySelector("#direction-from"), destination: document.querySelector("#direction-to") };
  const clearButtons = { source: panel.querySelector('[data-clear="source"]'), destination: panel.querySelector('[data-clear="destination"]') };
  const slots = { source: null, destination: null }; // { entry, feature }
  const touchScreen = window.matchMedia("(hover: none) and (pointer: coarse)");
  const phone = window.matchMedia("(max-width: 700px)");
  if (touchScreen.matches) inputs.source.placeholder = "Choose start, or tap the map";
  const placeholders = { source: inputs.source.placeholder, destination: inputs.destination.placeholder };
  let open = false;
  let picking = null; // the empty field the next click on the map fills
  let lastField = null; // the field focused last
  let walkOn = true;

  const entryText = (entry) => (entry.kind === "test" && entry.subtitle ? `${entry.title} · ${entry.subtitle}` : entry.kind === "place" && entry.meta ? `${entry.title} · ${entry.meta}` : entry.title);
  const otherKind = (kind) => (kind === "source" ? "destination" : "source");
  const buildingEntry = (feature) => getDirectory().entryForBuilding(feature) || { kind: "building", title: feature.properties?.name_en || "Building", buildingId: String(feature.properties?.id) };

  function updateControls() {
    KINDS.forEach((kind) => {
      // An emptied field still shows its chosen place until another is chosen.
      inputs[kind].placeholder = slots[kind] ? entryText(slots[kind].entry) : placeholders[kind];
      clearButtons[kind].hidden = !inputs[kind].value;
    });
    swap.disabled = !slots.source && !slots.destination;
  }

  // While the panel is open, a click on the map fills an empty field: the one
  // focused last, else the first one.
  function refreshPicking() {
    const empty = KINDS.filter((kind) => !slots[kind]);
    const next = open ? (empty.includes(lastField) ? lastField : empty[0] || null) : null;
    if (next === picking) return;
    picking = next;
    // entry: the room chosen on an open floor plan, when the click was on one.
    onPick?.(next ? (feature, entry = null) => { picking = null; choose(next, entry || buildingEntry(feature)); } : null);
  }

  function setOpen(next, { focus = false } = {}) {
    if (open !== next) {
      open = next;
      panel.hidden = !open;
      appTop.dataset.view = open ? "directions" : "search";
      if (!open) lastField = null;
    }
    refreshPicking();
    // With a mouse the first empty field is ready for typing; on a touch screen
    // the keyboard stays away until a field is tapped.
    if (open && focus && !touchScreen.matches) inputs[KINDS.find((kind) => !slots[kind])]?.focus();
  }

  function choose(kind, entry) {
    if (entry.kind === "location") {
      inputs[kind].value = "Finding your location…";
      Promise.resolve(onUseLocation?.()).then((found) => {
        if (found) return; // sync() has filled the field
        inputs[kind].value = slots[kind] ? entryText(slots[kind].entry) : "";
        updateControls();
      });
      return;
    }
    const feature = resolveFeature(entry);
    if (!feature) {
      inputs[kind].value = slots[kind] ? entryText(slots[kind].entry) : "";
      onMessage?.(`The building of “${entry.title}” is not recorded, so it cannot be used as the ${ROLE[kind]}.`);
      updateControls();
      refreshPicking();
      return;
    }
    slots[kind] = { entry, feature };
    inputs[kind].value = entryText(entry);
    updateControls();
    onUse?.(entry);
    onSetEndpoint(kind, feature, entry);
    refreshPicking();
  }

  const combos = {};
  KINDS.forEach((kind) => {
    const input = inputs[kind];
    combos[kind] = createCombobox({
      input,
      list: document.querySelector(`#${input.id}-results`),
      search: (query) => {
        const found = getDirectory().search(query, { kinds: ENTRY_KINDS[kind], limit: 20 });
        const typed = query.trim().toLowerCase();
        if (kind !== "source" || !onUseLocation || !LOCATION_WORDS.some((words) => words.startsWith(typed))) return found;
        return { results: [LOCATION_ENTRY, ...found.results], total: found.total + 1 };
      },
      suggest: () => [
        ...(kind === "source" && onUseLocation && slots.source?.entry !== LOCATION_ENTRY ? [LOCATION_ENTRY] : []),
        ...(getRecent?.({ kinds: ENTRY_KINDS[kind], exclude: [slots[otherKind(kind)]?.entry.key].filter(Boolean) }) || [])
      ],
      // "Your location" keeps its own icon among the places used last.
      renderItem: (entry, options) => resultItemHTML(entry, entry === LOCATION_ENTRY ? {} : options),
      onSelect: (entry) => {
        choose(kind, entry);
        if (!touchScreen.matches) return;
        if (slots[kind] && !slots[otherKind(kind)]) inputs[otherKind(kind)].focus();
        else input.blur();
      },
      onClear: () => { if (slots[kind]) onClearEndpoint(kind); },
      emptyText: "Nothing",
      fitToScreen: true
    });
    input.addEventListener("focus", () => {
      lastField = kind;
      refreshPicking();
      if (!touchScreen.matches || !slots[kind] || input.value !== entryText(slots[kind].entry)) return;
      input.value = "";
      combos[kind].show();
      updateControls();
    });
    input.addEventListener("input", updateControls);
    // Leaving a field without choosing restores the current endpoint's name.
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (document.activeElement === input) return;
        input.value = slots[kind] ? entryText(slots[kind].entry) : "";
        combos[kind].close();
        updateControls();
      }, 150);
    });
  });

  panel.addEventListener("click", (event) => {
    const clear = event.target.closest("[data-clear]");
    if (!clear) return;
    const kind = clear.dataset.clear;
    inputs[kind].value = "";
    combos[kind].close();
    if (slots[kind]) onClearEndpoint(kind); else updateControls();
    inputs[kind].focus();
  });

  swap.addEventListener("click", () => {
    if (slots.source?.entry === LOCATION_ENTRY) { onMessage?.("Your location can only be the starting point"); return; }
    [slots.source, slots.destination] = [slots.destination, slots.source];
    inputs.source.value = slots.source ? entryText(slots.source.entry) : "";
    inputs.destination.value = slots.destination ? entryText(slots.destination.entry) : "";
    updateControls();
    onSwap();
  });
  routeActions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-navigate]");
    if (button) onNavigate?.(button.dataset.navigate);
  });
  document.querySelector("#directions-open").addEventListener("click", () => setOpen(true, { focus: true }));
  // Close: the route goes, and the search box is back.
  document.querySelector("#directions-close").addEventListener("click", () => {
    const routed = Boolean(slots.source || slots.destination);
    KINDS.forEach((kind) => combos[kind].close());
    setOpen(false);
    if (routed) onClearRoute();
  });

  walk.addEventListener("click", () => {
    walkOn = !walkOn;
    walk.setAttribute("aria-pressed", String(walkOn));
    if (walkOn && (!slots.source || !slots.destination)) {
      const missing = !slots.source ? "source" : "destination";
      inputs[missing].focus();
      onMessage?.(`Choose a ${ROLE[missing]} for the walking route`);
    }
    onWalkChange?.(walkOn);
  });

  // Keeps the fields in step with endpoints set elsewhere (a card, a click on the
  // map, a deep link, swap, clear). An endpoint set elsewhere opens the panel.
  function sync(selection) {
    KINDS.forEach((kind) => {
      const feature = selection?.[kind] || null;
      // selection.position: the route starts at the visitor's position.
      if (!feature && kind === "source" && selection?.position) {
        if (slots.source?.entry === LOCATION_ENTRY) return;
        slots.source = { entry: LOCATION_ENTRY, feature: null };
        inputs.source.value = LOCATION_ENTRY.title;
      } else if (!feature) {
        slots[kind] = null;
        if (document.activeElement !== inputs[kind]) inputs[kind].value = "";
      } else {
        // selection.entries: the room chosen inside that building, when the endpoint is a room.
        const place = selection.entries?.[kind] || null;
        const current = slots[kind];
        const same = current?.feature === feature && (place ? current.entry.key === place.key : current.entry.kind !== "place");
        if (same) return;
        const entry = place || buildingEntry(feature);
        slots[kind] = { entry, feature };
        inputs[kind].value = entryText(entry);
      }
    });
    updateControls();
    if (selection?.source || selection?.destination || selection?.position) setOpen(true); else refreshPicking();
  }

  // Steps of a route that goes through floor plans (trip.js); clicking one shows it.
  const steps = document.querySelector("#route-steps");
  const accessibleOption = document.querySelector("#route-accessible-option");
  const accessible = document.querySelector("#route-accessible");
  let shownSteps = [];
  steps.addEventListener("click", (event) => {
    const item = event.target.closest("[data-step]");
    if (item) onStep?.(shownSteps[Number(item.dataset.step)]);
  });
  accessible.addEventListener("change", () => onStepFreeChange?.(accessible.checked));
  function showSteps(list) {
    shownSteps = list || [];
    steps.hidden = !shownSteps.length;
    steps.innerHTML = shownSteps.map((step, index) => `<li><button type="button" class="route-step" data-step="${index}"><span class="route-step-icon route-step-${escapeHTML(step.kind)}" data-icon="${escapeHTML(step.icon)}" aria-hidden="true"></span><span class="route-step-text"><strong>${escapeHTML(step.title)}</strong><small>${escapeHTML(step.detail)}</small></span></button></li>`).join("");
  }

  // Route summary: `description` from route-summary.js or trip.js, or null. It is
  // shown once both ends are chosen: the time and the distance, and the steps of a
  // route through floor plans, which fold away under it (open by default where
  // there is room, not on phones). The notes of a description are not shown.
  function showRoute(description) {
    summary.dataset.status = description?.status || "idle";
    const both = Boolean(slots.source && slots.destination);
    const complete = Boolean(walkOn && both && description);
    showSteps(complete ? description.steps : []);
    accessibleOption.hidden = !(complete && (description.floorChanges > 0 || accessible.checked));
    if (routeActions) routeActions.hidden = !(complete && description.navigable);
    summary.hidden = !both;
    headline.textContent = "";
    detail.textContent = "";
    if (both && !walkOn) {
      headline.textContent = "Walking route hidden";
      detail.textContent = "Select Walk to show the walking route.";
    } else if (complete) {
      headline.textContent = description.headline;
      detail.textContent = description.detail;
    }
    const wasHidden = more.hidden;
    more.hidden = !shownSteps.length;
    if (!more.hidden) {
      if (wasHidden) more.open = !phone.matches;
      moreLabel.textContent = `${shownSteps.length} step${shownSteps.length === 1 ? "" : "s"}`;
    }
    updateControls();
  }

  // Sets an endpoint from a directory entry ("Directions" or "Start here" on a
  // card), keeping the entry's own label, and opens the panel.
  function setEndpointEntry(kind, entry) {
    choose(kind, entry);
    setOpen(true, { focus: true });
  }

  showRoute(null);

  return {
    sync,
    showRoute,
    setEndpointEntry,
    isOpen: () => open,
    isWalkOn: () => walkOn,
    isStepFree: () => accessible.checked,
    closeLists() { KINDS.forEach((kind) => combos[kind].close()); }
  };
}
