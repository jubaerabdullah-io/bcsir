// Layers panel, opened from the layers button on the right-hand map controls.
// It holds the Street / Satellite basemap choice (basemap-control.js), the dark
// map switch and the layer visibility list.
//
// The visibility list is the original layer manager's (same groups, same saved
// choices). The building opacity / height-scale sliders, the category legend and
// the instruction note were removed from the interface only: every building
// still gets its heights, colours and category from BuildingBoundary.geojson.
import { LAYER_GROUPS } from "./bcsir-layers.js";
import { escapeHTML } from "./html.js";

const STORAGE_KEY = "bcsir-map-layers";

function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch (_) { return {}; }
}
function writeSaved(value) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch (_) { /* optional */ }
}

// onVisibilityChange(groupId, visible) is called for every group at start-up and
// on every toggle; main.js uses it to load and show each group's GLB models.
// `custom` handlers switch the parts that are not MapLibre layers.
// `suppressed` groups are drawn hidden whatever their switch says (the satellite
// basemap uses this); the switches and the saved choices are kept, so the groups
// come back as they were when the suppression ends.
export function createLayerManager({ map, custom = {}, onVisibilityChange, datasetCounts = {}, suppressed: initialSuppressed = [] }) {
  const button = document.querySelector("#layers-button");
  const panel = document.querySelector("#layers-panel");
  const list = document.querySelector("#layer-list");
  const saved = readSaved();
  const visibility = {};
  let suppressed = new Set(initialSuppressed);

  function applyGroup(group, visible) {
    visibility[group.id] = visible;
    const shown = visible && !suppressed.has(group.id);
    group.layers.forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", shown ? "visible" : "none"); });
    if (group.custom) custom[group.custom]?.(shown);
    onVisibilityChange?.(group.id, shown);
  }

  function updateSwitches() {
    list.querySelectorAll("[data-layer-group]").forEach((input) => {
      input.disabled = suppressed.has(input.dataset.layerGroup);
      input.closest(".layer-toggle").title = input.disabled ? "Hidden in satellite view" : "";
    });
  }

  list.innerHTML = LAYER_GROUPS.map((group) => {
    const count = datasetCounts[group.id];
    return `<label class="layer-toggle"><input type="checkbox" data-layer-group="${group.id}" checked /><span class="layer-switch" aria-hidden="true"></span><span class="layer-text"><strong>${escapeHTML(group.label)}</strong><small>${escapeHTML(group.source)}${Number.isFinite(count) ? ` · ${count} features` : ""}</small></span></label>`;
  }).join("");

  list.querySelectorAll("[data-layer-group]").forEach((input) => {
    const group = LAYER_GROUPS.find((item) => item.id === input.dataset.layerGroup);
    const visible = saved[group.id] !== false;
    input.checked = visible;
    applyGroup(group, visible);
    input.addEventListener("change", () => {
      applyGroup(group, input.checked);
      writeSaved({ ...readSaved(), [group.id]: input.checked });
    });
  });
  updateSwitches();

  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }
  setOpen(false);
  button.addEventListener("click", (event) => { event.stopPropagation(); setOpen(panel.hidden); });
  document.querySelector("#layers-panel-close")?.addEventListener("click", () => { setOpen(false); button.focus(); });
  document.addEventListener("pointerdown", (event) => { if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) setOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) { setOpen(false); button.focus(); } });

  return {
    isVisible: (id) => visibility[id] !== false,
    setVisible: (id, visible) => {
      const group = LAYER_GROUPS.find((item) => item.id === id);
      if (!group) return;
      applyGroup(group, visible);
      const input = list.querySelector(`[data-layer-group="${id}"]`);
      if (input) input.checked = visible;
    },
    // Hides the given groups (or none) without changing their switches.
    setSuppressed(ids = []) {
      const next = new Set(ids);
      const changed = LAYER_GROUPS.filter((group) => next.has(group.id) !== suppressed.has(group.id));
      suppressed = next;
      changed.forEach((group) => applyGroup(group, visibility[group.id] !== false));
      updateSwitches();
    },
    setOpen
  };
}
