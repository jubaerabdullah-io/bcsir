// Layers panel, opened from the layers button on the right-hand map controls.
// It holds the Street / Satellite basemap choice (basemap-control.js) and the
// dark map switch.
//
// This module also shows every layer group of the map (bcsir-layers.js). The
// list of switches that hid single groups was removed from the panel, and with
// it the saved choices: a group switched off earlier is drawn again.
import { LAYER_GROUPS } from "./bcsir-layers.js";

// onVisibilityChange(groupId, visible) is called for every group at start-up and
// whenever a group is hidden or shown; app.js uses it to load and show each
// group's GLB models. `custom` handlers switch the parts that are not MapLibre layers.
// `suppressed` groups are drawn hidden (the satellite basemap uses this); they
// come back when the suppression ends.
// onOpen() is called when the panel opens (app.js closes the View menu).
export function createLayerManager({ map, custom = {}, onVisibilityChange, onOpen, suppressed: initialSuppressed = [] }) {
  const button = document.querySelector("#layers-button");
  const panel = document.querySelector("#layers-panel");
  let suppressed = new Set(initialSuppressed);

  function applyGroup(group) {
    const shown = !suppressed.has(group.id);
    group.layers.forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", shown ? "visible" : "none"); });
    if (group.custom) custom[group.custom]?.(shown);
    onVisibilityChange?.(group.id, shown);
  }
  LAYER_GROUPS.forEach(applyGroup);

  // The panel hangs from the layers button: it may be as tall as the screen is above
  // the button's lower edge (--layers-room in style.css), and scrolls inside that.
  function fit() {
    if (panel.hidden) return;
    panel.style.setProperty("--layers-room", `${Math.max(160, Math.floor(button.getBoundingClientRect().bottom - 12))}px`);
  }
  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    fit();
    if (open) onOpen?.();
  }
  setOpen(false);
  window.addEventListener("resize", fit);
  button.addEventListener("click", (event) => { event.stopPropagation(); setOpen(panel.hidden); });
  document.querySelector("#layers-panel-close")?.addEventListener("click", () => { setOpen(false); button.focus(); });
  document.addEventListener("pointerdown", (event) => { if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) setOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) { setOpen(false); button.focus(); } });

  return {
    // Hides the given groups (or none).
    setSuppressed(ids = []) {
      const next = new Set(ids);
      const changed = LAYER_GROUPS.filter((group) => next.has(group.id) !== suppressed.has(group.id));
      suppressed = next;
      changed.forEach(applyGroup);
    },
    setOpen
  };
}
