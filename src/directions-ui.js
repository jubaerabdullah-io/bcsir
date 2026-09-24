// From / To directions panel.
//
// Both fields autocomplete from the campus directory. The From field offers
// buildings and laboratories; the To field also offers testing services. A
// laboratory or test is routed to the building recorded for it (see
// directory.js). If no building is recorded, it says so and sets no endpoint.
//
// The panel does not calculate routes. It sets the endpoints through the
// existing interaction controller (setSourceFeature / setDestinationFeature),
// and main.js routes with the original BCSIR routing service as before.
// The WALK tile is the travel-mode toggle: when it is on (the default) the
// walking route is drawn; when it is off the endpoints stay selected but no
// route is drawn.
//
// On touch screens a tapped field is emptied for typing (the chosen place stays
// as its placeholder), and choosing a result moves on to the other field if it
// is still empty, otherwise it closes the on-screen keyboard. While typing on a
// phone the panel moves to the top of the screen (.directions-editing).
import { createCombobox } from "./combobox.js";
import { escapeHTML } from "./html.js";

const KINDS = ["source", "destination"];
const ROLE = { source: "starting point", destination: "destination" };

// onNavigate(view) starts live guidance ("map") or the first-person 3D mode
// ("walk") on the drawn route; the Start / 3D mode buttons show only when a
// walking route is drawn (description.navigable).
export function createDirections({ getDirectory, resolveFeature, onSetEndpoint, onClearEndpoint, onSwap, onClearRoute, onPick, onWalkChange, onMessage, onNavigate }) {
  const panel = document.querySelector("#directions");
  const toggle = document.querySelector("#directions-toggle");
  const hint = document.querySelector("#direction-hint");
  const walk = document.querySelector("#walk-toggle");
  const summary = document.querySelector("#route-summary-box");
  const headline = document.querySelector("#route-headline");
  const detail = document.querySelector("#route-detail");
  const notes = document.querySelector("#route-notes");
  const clearRoute = document.querySelector("#clear-route");
  const routeActions = document.querySelector("#route-actions");
  const swap = document.querySelector("#direction-swap");
  const inputs = { source: document.querySelector("#direction-from"), destination: document.querySelector("#direction-to") };
  const placeholders = { source: inputs.source.placeholder, destination: inputs.destination.placeholder };
  const slots = { source: null, destination: null }; // { entry, feature }
  const touchScreen = window.matchMedia("(hover: none) and (pointer: coarse)");
  let picking = null;
  let walkOn = true;

  const entryText = (entry) => (entry.kind === "test" && entry.subtitle ? `${entry.title} · ${entry.subtitle}` : entry.title);
  const otherKind = (kind) => (kind === "source" ? "destination" : "source");

  function setExpanded(expanded) {
    panel.dataset.expanded = String(expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
  }

  function setEditing(editing) {
    panel.closest(".app-top")?.classList.toggle("directions-editing", editing);
  }

  function updateControls() {
    KINDS.forEach((kind) => {
      // An emptied field still shows its chosen place until another is chosen.
      inputs[kind].placeholder = slots[kind] ? entryText(slots[kind].entry) : placeholders[kind];
      panel.querySelector(`[data-clear="${kind}"]`).hidden = !inputs[kind].value;
      const pick = panel.querySelector(`[data-pick="${kind}"]`);
      pick.setAttribute("aria-pressed", String(picking === kind));
      pick.classList.toggle("active", picking === kind);
    });
    swap.disabled = !slots.source && !slots.destination;
    clearRoute.hidden = !slots.source && !slots.destination;
    hint.textContent = picking ? `Click a building on the map to set the ${ROLE[picking]}. Press Esc to cancel.` : "";
    hint.hidden = !picking;
  }

  function stopPicking() {
    if (!picking) return;
    picking = null;
    onPick?.(null);
    updateControls();
  }

  function choose(kind, entry) {
    const feature = resolveFeature(entry);
    if (!feature) {
      inputs[kind].value = slots[kind] ? entryText(slots[kind].entry) : "";
      onMessage?.(`The building of “${entry.title}” is not recorded, so it cannot be used as the ${ROLE[kind]}.`);
      updateControls();
      return;
    }
    stopPicking();
    slots[kind] = { entry, feature };
    inputs[kind].value = entryText(entry);
    updateControls();
    onSetEndpoint(kind, feature);
  }

  const combos = {};
  KINDS.forEach((kind) => {
    const input = inputs[kind];
    combos[kind] = createCombobox({
      input,
      list: document.querySelector(`#${input.id}-results`),
      search: (query) => getDirectory().search(query, { kinds: kind === "source" ? ["building", "lab"] : ["building", "lab", "test"], limit: 20 }),
      onSelect: (entry) => {
        choose(kind, entry);
        if (!touchScreen.matches) return;
        if (slots[kind] && !slots[otherKind(kind)]) inputs[otherKind(kind)].focus();
        else input.blur();
      },
      onClear: () => { if (slots[kind]) onClearEndpoint(kind); },
      emptyText: kind === "source" ? "No buildings or labs" : "No buildings, labs or tests",
      fitToScreen: true
    });
    input.addEventListener("focus", () => {
      if (!touchScreen.matches || !slots[kind] || input.value !== entryText(slots[kind].entry)) return;
      input.value = "";
      combos[kind].close();
      updateControls();
    });
    // Set on typing, not on focus: moving the panel under a tap that is still
    // in progress would send its click to whatever moved beneath the finger.
    input.addEventListener("input", () => { setEditing(true); updateControls(); });
    // Leaving a field without choosing restores the current endpoint's name.
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (document.activeElement === input) return;
        input.value = slots[kind] ? entryText(slots[kind].entry) : "";
        combos[kind].close();
        setEditing(KINDS.some((other) => document.activeElement === inputs[other]));
        updateControls();
      }, 150);
    });
  });

  panel.addEventListener("click", (event) => {
    const clear = event.target.closest("[data-clear]");
    if (clear) {
      const kind = clear.dataset.clear;
      inputs[kind].value = "";
      combos[kind].close();
      if (slots[kind]) onClearEndpoint(kind); else updateControls();
      inputs[kind].focus();
      return;
    }
    const pick = event.target.closest("[data-pick]");
    if (pick) {
      const kind = pick.dataset.pick;
      if (picking === kind) { stopPicking(); return; }
      picking = kind;
      onPick?.(kind, (feature) => {
        picking = null;
        choose(kind, getDirectory().entryForBuilding(feature) || { kind: "building", title: feature.properties?.name_en || "Building", buildingId: String(feature.properties?.id) });
      });
      updateControls();
    }
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && picking) stopPicking(); });

  swap.addEventListener("click", () => {
    [slots.source, slots.destination] = [slots.destination, slots.source];
    inputs.source.value = slots.source ? entryText(slots.source.entry) : "";
    inputs.destination.value = slots.destination ? entryText(slots.destination.entry) : "";
    updateControls();
    onSwap();
  });
  clearRoute.addEventListener("click", () => onClearRoute());
  routeActions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-navigate]");
    if (button) onNavigate?.(button.dataset.navigate);
  });
  toggle.addEventListener("click", () => setExpanded(panel.dataset.expanded !== "true"));

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

  // Keeps the fields in step with endpoints set elsewhere (building card,
  // map pick, deep link, swap, clear).
  function sync(selection) {
    KINDS.forEach((kind) => {
      const feature = selection?.[kind] || null;
      if (!feature) {
        slots[kind] = null;
        if (document.activeElement !== inputs[kind]) inputs[kind].value = "";
      } else if (slots[kind]?.feature !== feature) {
        const entry = getDirectory().entryForBuilding(feature) || { kind: "building", title: feature.properties?.name_en || "Building" };
        slots[kind] = { entry, feature };
        inputs[kind].value = entryText(entry);
      }
    });
    if (selection?.source || selection?.destination) setExpanded(true);
    updateControls();
  }

  // Route summary: `description` from route-summary.js, or null.
  function showRoute(description) {
    summary.dataset.status = description?.status || "idle";
    notes.innerHTML = "";
    if (routeActions) routeActions.hidden = !(description?.navigable && walkOn && slots.source && slots.destination);
    if (!slots.source && !slots.destination) {
      headline.textContent = "";
      detail.textContent = "";
    } else if (!slots.source || !slots.destination) {
      headline.textContent = !slots.source ? "Choose a starting point" : "Choose a destination";
      detail.textContent = "The walking route appears when both are set.";
    } else if (!walkOn) {
      headline.textContent = "Walking route hidden";
      detail.textContent = "Select WALK to show the walking route.";
    } else if (description) {
      headline.textContent = description.headline;
      detail.textContent = description.detail;
      notes.innerHTML = description.notes.map((note) => `<li>${escapeHTML(note)}</li>`).join("");
    }
    updateControls();
  }

  // Sets an endpoint from a directory entry (e.g. "Directions to here" on a
  // test shown in the building card), keeping the entry's own label.
  function setEndpointEntry(kind, entry) {
    setExpanded(true);
    choose(kind, entry);
  }

  setExpanded(!window.matchMedia("(max-width: 700px)").matches);
  showRoute(null);

  return {
    sync,
    showRoute,
    setEndpointEntry,
    setExpanded,
    isWalkOn: () => walkOn,
    closeLists() { KINDS.forEach((kind) => combos[kind].close()); stopPicking(); }
  };
}
