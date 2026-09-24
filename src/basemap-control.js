// Street / Satellite choice in the layers panel. Switching changes which raster
// basemap layer is visible (see basemaps.js) and reports the choice through
// onChange; main.js then hides the drawn campus layers while satellite is shown.
// The camera, route, pins and labels are not touched.
import { BASEMAPS, DEFAULT_BASEMAP, basemapById, basemapVisibility, thumbnailUrl } from "./basemaps.js";
import { escapeHTML } from "./html.js";

const STORAGE_KEY = "bcsir-map-basemap";

export function savedBasemap() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return basemapById(value) ? value : DEFAULT_BASEMAP;
  } catch (_) {
    return DEFAULT_BASEMAP;
  }
}

export function createBasemapControl(map, { container, center, onChange }) {
  let active = savedBasemap();
  let enabled = true;

  // Thumbnails are the basemap's own tile of the campus; if one cannot load,
  // the coloured placeholder behind it stays.
  container.innerHTML = BASEMAPS.map((basemap) => `<button type="button" class="basemap-option" data-basemap="${basemap.id}" aria-pressed="false"><span class="basemap-thumb basemap-thumb-${basemap.id}"><img src="${escapeHTML(thumbnailUrl(basemap.id, center))}" alt="" loading="lazy" decoding="async" /></span><span class="basemap-name">${escapeHTML(basemap.label)}</span></button>`).join("");
  container.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => image.remove(), { once: true }));

  function apply() {
    Object.entries(basemapVisibility(active, enabled)).forEach(([layer, visibility]) => {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visibility);
    });
    container.querySelectorAll("[data-basemap]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.basemap === active)));
    document.documentElement.dataset.basemap = active;
  }

  function set(id) {
    if (!basemapById(id)) return;
    active = id;
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) { /* preference is optional */ }
    apply();
    onChange?.(id);
  }

  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-basemap]");
    if (button) set(button.dataset.basemap);
  });
  apply();

  return {
    get: () => active,
    set,
    // The "Basemap" switch in the layer list hides or shows the active basemap.
    setEnabled(next) { enabled = next; apply(); }
  };
}
