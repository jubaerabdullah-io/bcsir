// Building information card, toast, loading status, theme and zoom buttons.
// Adapted from the reference project's src/ui.js; shop fields are replaced by
// the BuildingBoundary.geojson attributes (name_en, name_bn, name_en_short,
// name_en_alias, image_url, site_url, entrance_coords, area, color, id) and
// the visualization properties (base_m, top_m, image).
//
// The card can also show why a building was opened: a laboratory / research
// division or a testing service chosen in the search. The search bar and the
// directions panel live in search-ui.js and directions-ui.js. The hover preview
// card was removed (hovering only highlights the building).
import { setMapTheme, zoomBy } from "./map.js";
import { publicAssetUrl } from "./paths.js";
import { buildingImageCandidates, imageManifest } from "./building-images.js";
import { formatDuration, formatFee } from "./directory.js";
import { kindIcon } from "./combobox.js";
import { escapeHTML } from "./html.js";

export { escapeHTML };

const $ = (selector) => document.querySelector(selector);
const FALLBACK_BUILDING_IMAGE = publicAssetUrl("building-placeholder.svg");

// Reference setImage(): try candidates in order, then fall back.
function setImage(element, candidates, fallback) {
  const list = candidates.filter(Boolean);
  let index = 0;
  element.onerror = () => {
    if (index < list.length) { element.src = list[index++]; return; }
    element.onerror = null;
    element.src = fallback;
  };
  if (list.length) element.src = list[index++];
  else { element.onerror = null; element.src = fallback; }
}

export function createUI({ map, onClearSelection, onReset, onSetSource, onSetDestination }) {
  const card = $("#building-card"); const context = $("#card-context"); const toast = $("#toast"); const themeToggle = $("#theme-toggle");
  let activeFeature = null; let activeContext = null; let pendingContext = null; let routeSelection = { source: null, destination: null }; let toastTimer;

  function applyTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#171a1c" : "#f4f7f8");
    themeToggle.setAttribute("aria-pressed", String(next === "dark"));
    setMapTheme(map, next);
    try { localStorage.setItem("bcsir-map-theme", next); } catch (_) { /* preference is optional */ }
  }
  let savedTheme = "light";
  try { savedTheme = localStorage.getItem("bcsir-map-theme") || "light"; } catch (_) { /* preference is optional */ }
  applyTheme(savedTheme);
  themeToggle.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("#zoom-in").addEventListener("click", () => zoomBy(map, .8)); $("#zoom-out").addEventListener("click", () => zoomBy(map, -.8)); $("#reset-view").addEventListener("click", onReset);

  function currentRouteKind(feature) { const id = feature?.properties?.render_id; if (routeSelection.source?.properties?.render_id === id) return "source"; if (routeSelection.destination?.properties?.render_id === id) return "destination"; return ""; }
  function refreshActions() {
    const kind = currentRouteKind(activeFeature);
    const sourceButton = $("#set-source"), destinationButton = $("#set-destination");
    sourceButton.classList.toggle("active-route-action", kind === "source");
    destinationButton.classList.toggle("active-route-action", kind === "destination");
    sourceButton.setAttribute("aria-pressed", String(kind === "source"));
    destinationButton.setAttribute("aria-pressed", String(kind === "destination"));
    sourceButton.querySelector(".route-label").textContent = kind === "source" ? "Starting point" : "Start here";
    destinationButton.querySelector(".route-label").textContent = kind === "destination" ? "Destination" : "Directions to here";
  }

  // Laboratory / test that led to this building (from the search).
  function renderContext(entry) {
    activeContext = entry;
    context.hidden = !entry;
    card.classList.toggle("has-context", Boolean(entry));
    if (!entry) { context.innerHTML = ""; return; }
    const facts = [];
    let kindLabel = entry.typeLabel || "Laboratory";
    let lines = [];
    let source = null;
    if (entry.kind === "test") {
      kindLabel = "Testing service";
      const service = entry.record;
      if (entry.subtitle) facts.push(["Sample", entry.subtitle]);
      if (service.method) facts.push(["Method", service.method]);
      if (formatFee(service)) facts.push(["Fee", formatFee(service)]);
      if (formatDuration(service)) facts.push(["Time", formatDuration(service)]);
      if (entry.lab) lines.push(`Offered by <strong>${escapeHTML(entry.lab.name)}${entry.lab.short_name ? ` (${escapeHTML(entry.lab.short_name)})` : ""}</strong>`);
      if (entry.source) source = { url: entry.source.url, text: `${entry.source.title}, ${service.source_ref}${entry.source.retrieved ? ` (retrieved ${entry.source.retrieved})` : ""}` };
    } else {
      const parent = entry.parents?.[0];
      if (parent) lines.push(`Part of <strong>${escapeHTML(parent.name)}${parent.short_name ? ` (${escapeHTML(parent.short_name)})` : ""}</strong>`);
      if (entry.locatedVia) lines.push(`Location: the building recorded for ${escapeHTML(entry.locatedVia.short_name || entry.locatedVia.name)}`);
      if (entry.record?.source_url) source = { url: entry.record.source_url, text: new URL(entry.record.source_url).hostname };
    }
    context.innerHTML = `<div class="context-kind">${kindIcon(entry.kind)}<span>${escapeHTML(kindLabel)}</span></div>
      <h3 class="context-title">${escapeHTML(entry.title)}</h3>
      ${facts.length ? `<dl class="context-facts">${facts.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join("")}</dl>` : ""}
      ${lines.map((line) => `<p class="context-line">${line}</p>`).join("")}
      ${source ? `<a class="context-source" href="${escapeHTML(source.url)}" target="_blank" rel="noopener">Source: ${escapeHTML(source.text)}</a>` : ""}`;
  }

  // Called by main.js right before a search result selects its building.
  function setPendingContext(entry) { pendingContext = entry || null; }

  function showBuilding(feature) {
    if (!feature) return;
    activeFeature = feature;
    const p = feature.properties || {};
    const entry = pendingContext && String(pendingContext.buildingId) === String(p.id) ? pendingContext : null;
    pendingContext = null;
    renderContext(entry);
    card.style.setProperty("--shop-accent", p.render_color);
    $("#building-located").hidden = !entry;
    $("#building-name").textContent = String(p.name_en || p.render_label).trim();
    $("#building-name-bn").textContent = p.name_bn || "";
    $("#building-name-bn").hidden = !p.name_bn;
    $("#building-category").textContent = p.render_category_label || "Building";
    $("#building-id").textContent = p.id ?? "—";
    const aliases = [p.name_en_short, p.name_en_alias].filter(Boolean);
    $("#building-alias").textContent = aliases.join(" · ");
    $("#building-alias").hidden = !aliases.length;
    const heightText = `${p.render_height_m.toFixed(1)} m${p.render_base_m ? ` from ${p.render_base_m} m` : ""}`;
    $("#building-height").textContent = p.render_height_source === "default" ? `${heightText} (default)` : heightText;
    $("#building-entrance").textContent = Number.isFinite(p.entrance_lon) ? "Recorded" : "Not recorded";
    const site = $("#building-site");
    site.hidden = !p.site_url;
    if (p.site_url) { site.href = p.site_url; site.textContent = p.site_url.replace(/^https?:\/\//, "").replace(/\/$/, ""); }
    imageManifest.then(() => { if (activeFeature === feature) setImage($("#building-image"), buildingImageCandidates(p), FALLBACK_BUILDING_IMAGE); });
    refreshActions(); card.hidden = false;
    card.scrollTop = 0;
  }
  function hideBuilding() { activeFeature = null; renderContext(null); card.hidden = true; }
  function showToast(message) { clearTimeout(toastTimer); toast.textContent = message; toast.classList.add("show"); toastTimer = setTimeout(() => toast.classList.remove("show"), 3200); }

  function updateRouteSelection(next) {
    routeSelection = next || { source: null, destination: null };
    refreshActions();
  }

  $("#building-card-close").addEventListener("click", () => onClearSelection?.());
  $("#set-source").addEventListener("click", () => activeFeature && onSetSource?.(activeFeature, activeContext));
  $("#set-destination").addEventListener("click", () => activeFeature && onSetDestination?.(activeFeature, activeContext));

  // Loading / error status. Dataset statistics are no longer shown.
  function setStatus(message, type = "loading") {
    const chip = $("#status-chip");
    $("#map-status").textContent = message;
    const dot = $(".status-dot"); dot.classList.remove("ready", "error"); dot.classList.add(type);
    chip.hidden = false;
  }
  function hideStatus() { $("#status-chip").hidden = true; }

  return { showBuilding, hideBuilding, showToast, setStatus, hideStatus, setPendingContext, updateRouteSelection, activeBuilding: () => activeFeature };
}
